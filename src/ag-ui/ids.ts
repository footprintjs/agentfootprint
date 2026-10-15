/**
 * ids — every id the AG-UI adapter mints, from ONE grammar.
 *
 *   <run>/<kind>/<n>/<address>
 *
 *   run      the AG-UI `runId`, through `encodeIdentityField` — `%` and `/`
 *            escaped, so it holds no `/`;
 *   kind     one of {@link AgUiIdKind} — no `/`;
 *   n        a decimal ordinal — no `/`;
 *   address  the agentfootprint `runtimeStageId` of the event that opened the
 *            entity (`call-llm#18`, `step-p/x/tool-calls#97`) — any string.
 *
 * INJECTIVE by construction: the first three `/` end the three segments that
 * cannot hold one, so two different (run, kind, n, address) tuples never spell
 * the same id. `test/ag-ui/ids.test.ts` pins it with a property test.
 *
 * WHY THE ADDRESS, NOT THE PROVIDER'S ID. A model's tool-call id is not unique
 * in a run: a provider may reuse it across iterations, and two parallel branches
 * routinely mint the same one (`call_1`, `c1`). An AG-UI client finds a tool
 * call by its id across the WHOLE conversation, so a reused id would land a new
 * call's arguments on an old message. And under a redaction policy the record
 * serves every id as the placeholder. The address — the stage execution that
 * produced the entity, unique within a run — is unique, survives redaction (it
 * is the record's own key, never a value a policy selects) and lines up with the
 * recording; the run segment makes it unique across the thread. The provider's
 * id, as the record serves it, rides `metadata.agentfootprint.toolCallId`.
 */

import { encodeIdentityField } from '../memory/identity/encode.js';

/** The kinds of entity the adapter mints ids for. */
export type AgUiIdKind = 'text' | 'reasoning' | 'tool' | 'result' | 'agent' | 'interrupt';

/** One run's minter: ordinals counted per (kind, address), ids spelled by {@link agUiId}. */
export interface AgUiIdMinter {
  /** The next id of `kind` at `address` — `n` counts up from 0 per (kind, address). */
  next(kind: AgUiIdKind, address: string): { readonly id: string; readonly n: number };
  /** The id of `kind` at `address` with a KNOWN ordinal — a tool result reuses its call's. */
  at(kind: AgUiIdKind, n: number, address: string): string;
}

/** Spell one id. Exported for the property test; the minter is the only caller. */
export function agUiId(runId: string, kind: AgUiIdKind, n: number, address: string): string {
  return `${encodeIdentityField(runId)}/${kind}/${n}/${address}`;
}

/** A minter for the AG-UI run `runId`. Refuses an empty run id: it would mint `_` ids. */
export function agUiIdMinter(runId: string): AgUiIdMinter {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new TypeError(
      'AG-UI: `runId` must be a non-empty string — every id the run mints is under it.',
    );
  }
  const counts = new Map<string, number>();
  return {
    next(kind, address) {
      const key = `${kind}\u0000${address}`;
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      return { id: agUiId(runId, kind, n, address), n };
    },
    at: (kind, n, address) => agUiId(runId, kind, n, address),
  };
}
