import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import {
  type CoverageReading,
  readCoverageResult,
  type DeclaredCoverage,
  type CoverageFacts,
  type ToolAbsence,
} from '../../../../../semantics/coverage/index.js';
import type { ToolResultStatus } from '../../../../../semantics/toolEffects.js';
import { copyPeriod } from '../../../../../semantics/coverage/period.js';
import { warnPeriodUnjudged } from '../helpers/periodWarnings.js';
import { type CoverageSection, readItemExtras } from '../../../../../semantics/coverage/items.js';
import { copyInProgressItem } from '../../../../../semantics/coverage/inProgress.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import { composedEventFields } from '../../../../../semantics/coverage/search/events.js';
import type { ComposedCoverage } from '../../../../../semantics/coverage/composedCoverage.js';
import { captureNegativeCoverage } from '../../../negativeClaims/capture.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ToolCoverageOperations } from '../contracts/operations/coverage.js';
import type { ToolIntegrityOperations } from '../contracts/operations/integrity.js';

interface ToolCoverageOperationsLinks {
  readonly noticeEmptyLookup: ToolIntegrityOperations['noticeEmptyLookup'];
}

/** Compose the existing coverage callbacks once for this handler. */
export function buildToolCoverageOperations(
  deps: Pick<ToolCallsHandlerDeps, 'resultsLayer' | 'negativeClaimsArmed'>,
  links: ToolCoverageOperationsLinks,
): ToolCoverageOperations {
  /**
   * Coverage declarations — `absent(…)` and `coverage(…)`, recognized at the
   * SAME execute boundaries the ceiling is measured at (one implementation,
   * every door: a resumed call declares its coverage exactly as an inline
   * one).
   *
   * Returns the DELIVERED status: `'absent'` when an absence is in play,
   * `undefined` otherwise. That single line is the whole downstream
   * behavioural change, and it is deliberately narrow — an absence is not an
   * error, so nothing here sets `error: true`, nothing refuses, nothing
   * retries, and the value the model reads is the value the tool minted. The
   * direction-of-error argument (see `../../../../../semantics/coverage/absent.ts`) is that a
   * *nothing-found* routed as a *failure* sends someone to investigate a
   * healthy collector, while a *failure* routed as *nothing-found* declares a
   * system fine that was never checked; giving the outcome its own word is
   * how `onToolStatus` edges stop having to guess.
   *
   * The RECORD keeps the coverage twice over: on the emit channel (per-call
   * facts belong there) and, because a limit is a fact about the ANSWER
   * rather than about an attempt, in tracked state — where the final-answer
   * block reads it. Written only when a tool declares one, so an agent that
   * returns neither shape commits exactly what it always did.
   */
  const declareCoverage = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
    /** What the search funnel composed (`../../searchCoverage.ts`) — read in place of the value. */
    composed?: CoverageReading,
  ): ToolResultStatus | undefined => {
    const reading = composed ?? readCoverageResult(value, call.toolName);
    if (reading === undefined) return undefined;
    const rows: DeclaredCoverage[] = [];
    for (const facts of reading.declared) {
      // A statement the LIBRARY composed from the tool's `search`: the row
      // carries the typed items and gaps, the events carry no composed value.
      if (facts.composed !== undefined) {
        rows.push(declareComposed(scope, call, facts));
        continue;
      }
      // Honesty step 7b: a declared period rides the event and the tracked row
      // (read by the ONE period rule — a malformed one never reaches here), as
      // a copy. Filed whatever the agent armed: it is the tool's declaration.
      // Its VERDICT is the results layer's — say so when that layer is not
      // mounted, so a period nobody judges is never silently inert.
      const period = facts.period !== undefined ? copyPeriod(facts.period) : undefined;
      if (period !== undefined && deps.resultsLayer !== true) {
        warnPeriodUnjudged(call.toolName);
      }
      // Copied item by item — event payloads are detached plain data, never
      // a shared reference into a value the tool still holds. The
      // record-only extras (`short`, `kind`) ride along when valid, read by
      // the ONE non-throwing reader (`coverage/items.ts` · `readItemExtras`),
      // so the event and the tracked row carry the same fields; the model is
      // served the envelope without them (`afterMoment`, below).
      const copy = (list: CoverageFacts['coverage']['checked'], section: CoverageSection) =>
        list.map((i) => ({
          what: i.what,
          ...(i.why !== undefined && { why: i.why }),
          ...readItemExtras(i, section, call.toolName),
        }));
      const checked = copy(facts.coverage.checked, 'checked');
      const notChecked = copy(facts.coverage.notChecked, 'notChecked');
      const cannotCover = copy(facts.coverage.cannotCover, 'cannotCover');
      // What a ledger's read found still running (`coverage/inProgress.ts`) —
      // read by its ONE rule set, so every item here is well-formed; copied.
      const inProgress = facts.inProgress?.map(copyInProgressItem);
      if (facts.kind === 'absence') {
        typedEmit(scope, 'agentfootprint.tools.absent', {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          iteration: call.iteration,
          ...(facts.lookedFor !== undefined && { lookedFor: facts.lookedFor }),
          checked,
          ...(notChecked.length > 0 && { notChecked }),
          ...(cannotCover.length > 0 && { cannotCover }),
          // The suggestion, as declared (9.113.0): the sentence, and the
          // typed tool as a copy (`tryInsteadToolOfAbsence`). The EVENT only:
          // it is advice about a call not yet made, not ground the answer
          // stands on, so the tracked row below and the block composed from
          // it never carry it.
          ...(facts.tryInstead !== undefined && { tryInstead: facts.tryInstead }),
          ...(facts.tryInsteadTool !== undefined && { tryInsteadTool: facts.tryInsteadTool }),
          // Honesty step 7b — where the search looked and when (the event only:
          // the limits block prints coverage, never a source), and the period.
          ...(facts.provenance !== undefined && { provenance: { ...facts.provenance } }),
          ...(period !== undefined && { period: copyPeriod(period) }),
        });
      } else {
        typedEmit(scope, 'agentfootprint.tools.coverage_declared', {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          iteration: call.iteration,
          ...(checked.length > 0 && { checked }),
          ...(notChecked.length > 0 && { notChecked }),
          ...(cannotCover.length > 0 && { cannotCover }),
          ...(inProgress !== undefined && { inProgress: inProgress.map(copyInProgressItem) }),
          ...(period !== undefined && { period: copyPeriod(period) }),
        });
      }
      rows.push({
        kind: facts.kind,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
        ...(facts.lookedFor !== undefined && { lookedFor: facts.lookedFor }),
        checked,
        notChecked,
        cannotCover,
        ...(period !== undefined && { period }),
        ...(inProgress !== undefined && { inProgress }),
      });
    }
    scope.coverageDeclared = [...(scope.coverageDeclared ?? []), ...rows];
    return reading.status;
  };

  /**
   * One COMPOSED statement (`Tool.search`) — its event and its row. The row is
   * the committed record: every value, under the run's redaction policy, at
   * the address the funnel reserved (`resultId`). The event carries the
   * declaration's constants, the gaps and each other facet as a reference —
   * never a composed value, armed or not (`search/events.ts`).
   */
  const declareComposed = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    facts: CoverageFacts,
  ): DeclaredCoverage => {
    const composed = facts.composed as NonNullable<CoverageFacts['composed']>;
    const period = facts.period !== undefined ? copyPeriod(facts.period) : undefined;
    if (period !== undefined && deps.resultsLayer !== true) warnPeriodUnjudged(call.toolName);
    const event = composedEventFields(facts, { armed: deps.negativeClaimsArmed === true });
    const base = {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
    };
    if (facts.kind === 'absence') {
      typedEmit(scope, 'agentfootprint.tools.absent', {
        ...base,
        ...(event.lookedFor !== undefined && { lookedFor: event.lookedFor }),
        ...(event.lookedForRef !== undefined && { lookedForRef: event.lookedForRef }),
        checked: event.checked,
        ...(event.notChecked.length > 0 && { notChecked: event.notChecked }),
        ...(event.cannotCover.length > 0 && { cannotCover: event.cannotCover }),
        ...(facts.tryInstead !== undefined && { tryInstead: facts.tryInstead }),
        ...(facts.tryInsteadTool !== undefined && { tryInsteadTool: facts.tryInsteadTool }),
        ...(facts.provenance !== undefined && { provenance: { ...facts.provenance } }),
        ...(period !== undefined && { period: copyPeriod(period) }),
        composition: event.composition,
      });
    } else {
      typedEmit(scope, 'agentfootprint.tools.coverage_declared', {
        ...base,
        ...(event.checked.length > 0 && { checked: event.checked }),
        ...(event.notChecked.length > 0 && { notChecked: event.notChecked }),
        ...(event.cannotCover.length > 0 && { cannotCover: event.cannotCover }),
        ...(facts.inProgress !== undefined && {
          inProgress: facts.inProgress.map(copyInProgressItem),
        }),
        ...(period !== undefined && { period: copyPeriod(period) }),
        composition: event.composition,
      });
    }
    // Detached plain data: the row must not share a reference with a value
    // the tool still holds (a sent argument object, the declaration's lists).
    const row: ComposedCoverage = structuredClone({
      kind: facts.kind,
      ...base,
      composed: composed.origin,
      resultId: composed.resultId,
      handle: composed.handle,
      ...(facts.lookedFor !== undefined && { lookedFor: facts.lookedFor }),
      checked: facts.coverage.checked as ComposedCoverage['checked'],
      notChecked: facts.coverage.notChecked,
      cannotCover: facts.coverage.cannotCover,
      complete: composed.complete,
      gaps: composed.gaps,
      ...(period !== undefined && { period }),
      ...(facts.inProgress !== undefined && { inProgress: facts.inProgress }),
    });
    if (deps.negativeClaimsArmed === true) captureNegativeCoverage(scope, row);
    return row;
  };

  /**
   * A lookup that pauses still declares what it looked at (9.114.0) — the
   * RAISE-SITE reader of `InputRequestDeclaration.absence`.
   *
   * A tool that found nothing and raised `requestInput` about the miss used
   * to leave no record of it: `declareCoverage` reads a RETURNED value, and
   * the pause branch returns the checkpoint before any of its call sites.
   * The app could not file it either — the declaration's `context` rides to
   * the model on resume, never to the record. So the raise site files it,
   * through the same two readers a returned absence meets: `declareCoverage`
   * (the one recognizer, `tools.absent`, the `coverageDeclared` row — the
   * bytes a returned `absent(…)` files) and the empty-lookup write seam, with
   * the envelope as the tool's own answer — it ran, nothing errored, nothing
   * denied it, and no ceiling judged a result the model was never served.
   *
   * The delivered status `declareCoverage` returns is dropped on purpose: a
   * paused call is not settled, so there is no `tool_end` for it to ride.
   * Nothing on resume reads the field (the served result there is the
   * person's `InputResponseResult`), so the rows are filed once, here.
   *
   * CONTAINED the way the returned path contains it. The recognizer reads an
   * envelope minted elsewhere without repairing it, so its lists can be
   * something `declareCoverage` cannot copy (`checked: [null]`,
   * `not_checked: 5`). Returned, that throw lands in the dispatch `try` and
   * errors the call; here it would land in the `catch` and fail the run. So
   * the copy is caught here instead, and the error text comes back: the
   * caller errors the call with it and does not pause. That is what the same
   * value returned would do. `undefined` means filed.
   */
  const declareRaisedAbsence = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    args: Readonly<Record<string, unknown>>,
    absence: ToolAbsence,
    history: readonly LLMMessage[],
  ): string | undefined => {
    try {
      declareCoverage(scope, call, absence);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    links.noticeEmptyLookup(scope, call, args, absence, history, true);
    return undefined;
  };

  return { declareCoverage, declareComposed, declareRaisedAbsence };
}
