import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { type TypedScope, isDevMode } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import {
  readSemantics,
  explainSemantics,
  semanticsForModel,
} from '../../../../../semantics/envelope.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolSemantics } from '../../../../../semantics/types.js';
import { claimRowsOf } from '../../../../../integrity/unsupported-claim/ledger.js';
import type { ClaimLedgerRow } from '../../../../../integrity/unsupported-claim/check.js';
import type { ToolSemanticsOperations } from '../contracts/operations/semantics.js';

/** Compose the existing semantics callbacks once for this handler. */
export function buildToolSemanticsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'collectClaimFacts'>,
): ToolSemanticsOperations {
  /**
   * The semantic envelope (9.53.0) — recognized at the SAME execute
   * boundaries as coverage and the ceiling (one implementation, every door),
   * AFTER `declareCoverage` (which absorbs the envelope's `coverage` field
   * through the one coverage funnel) and BEFORE `refuseOverCeiling` (so the
   * FULL envelope — grain, provenance, render, coverage — is on the record
   * even when the content is refused as oversized: a caveat that died with
   * an oversized result would be the silence the envelope exists to break).
   *
   * Returns the MODEL's view — the compact rendering-free projection
   * (`semanticsForModel`: data + grain + provenance + composed `not_covered`
   * + non-null clarify + the static note; never the marker, `render`, or the
   * three-list coverage detail) — or `undefined` for every non-envelope
   * value, which keeps today's path byte for byte. The full envelope rides
   * the typed `tools.semantics_declared` event, so recordings and UIs get
   * everything the model was spared.
   *
   * A value CARRYING the marker that this library cannot honor stays DATA
   * (never half-applied — the recognition strictness law) and is dev-warned
   * here naming its first fault; `check:semantics` names them all at build
   * time.
   */
  const declareSemantics = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
  ): unknown | undefined => {
    const sem = readSemantics(value);
    if (sem === undefined) {
      const faults = explainSemantics(value);
      if (faults !== undefined && faults.length > 0 && isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint semantics: tool '${call.toolName}' returned a value carrying ` +
            `af_semantics that was NOT recognized (treated as plain data): ` +
            `${faults[0].message} (field: ${faults[0].field})` +
            (faults.length > 1 ? ` — and ${faults.length - 1} more; run check:semantics.` : ''),
        );
      }
      return undefined;
    }
    // Detached plain data for the record — the event must not hold a live
    // reference into a value the tool still owns. An envelope that cannot
    // survive structuredClone cannot ride the record (or a checkpoint), so
    // it is declined here — data path, dev-warned — rather than half-filed.
    let detached: unknown;
    try {
      detached = structuredClone(sem);
    } catch {
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint semantics: tool '${call.toolName}' returned a semantic envelope ` +
            `that does not survive structuredClone (a function or live handle in a fact row?) ` +
            `— treated as plain data. Envelope values must be plain data.`,
        );
      }
      return undefined;
    }
    typedEmit(scope, 'agentfootprint.tools.semantics_declared', {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      semantics: detached as ToolSemantics,
    });
    // THE CLAIM LEDGER (9.61.0). The envelope's typed readings are absorbed
    // into tracked state here — the `coverageDeclared` shape one function
    // up — because the projection returned below REPLACES the envelope on
    // the wire, and after that the typed object exists nowhere a check
    // could read it. Written only when a tool actually declares readings,
    // so an agent whose tools return none commits exactly what it did
    // before. Rows carry the DETACHED values: a ledger holding live
    // references into a value the tool still owns would compare against
    // whatever that value became later.
    // GATED on a declared contract: with nothing to read these rows, they
    // would be committed state and checkpoint weight bought for nobody.
    if (deps.collectClaimFacts === true) {
      const rows = claimRowsOf(detached as ToolSemantics, call);
      if (rows.length > 0) {
        // `concat` over spread: one copy of the existing rows instead of
        // re-spreading element by element. The write itself is still a
        // fresh array — committed state is immutable-after-swap, so the
        // prior value must never be mutated in place.
        scope.claimFacts = ((scope.claimFacts ?? []) as ClaimLedgerRow[]).concat(rows);
      }
    }
    return semanticsForModel(sem);
  };

  return { declareSemantics };
}
