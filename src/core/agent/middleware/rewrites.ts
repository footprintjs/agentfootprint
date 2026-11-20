/**
 * middleware/rewrites — which arguments a before-tool middleware rewrote, read
 * off the record: the ONE reading the answer's standing and the answer's
 * "Assumed" block both take.
 *
 * Pattern: One pure function over committed rows. No scope, no clock; the
 *          input is read, never trusted.
 * Role:    core/agent leaf (honesty layer 2). Under the inputs layer, a
 *          before-tool rewrite of a RULED tool's arguments is filed on
 *          `middlewareDecisions` with the NAMES of the keys it changed
 *          (`MiddlewareDecision.changedKeys`, stamped by
 *          `arguments/dispatch.ts` · `withChangedKeys`) and, when the middleware
 *          declared one, where each value came from
 *          (`allow(args, why, { from })`). The layer checked the value BEFORE
 *          the chain ran, so a rewrite supersedes the layer's row: the value
 *          the call ran with is the rewrite's. Two readers must agree on that —
 *          `assessment/assess.ts` · `readArgumentVerdicts` (the standing) and
 *          `arguments/serve/assumed.ts` · `assumedBlockOf` (the "Assumed" block) —
 *          and both load through `import()` (the fold on first use, the block
 *          under the arm), so neither can own the reading for the other: it
 *          lives here, once, and a plain agent's graph carries it for neither.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * const decision = { at: 'tool', toolCallId: 'c1', changedKeys: ['window'], from: { window: 'person' } };
 * const call = rewriteCallAddress(decision);
 * if (call !== undefined)
 *   argumentRewritesOf([decision], rewriteCallAddress).get(call)?.get('window');
 * // { index: 0, origin: 'person' }
 * ```
 */

import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';

/** A before-tool rewrite of one argument — the last per (call, argument). */
export interface ArgumentRewrite {
  /** Where the rewrite's row sits in `middlewareDecisions` — the witness a reader points at. */
  readonly index: number;
  /** The middleware's declared origin for the argument (`'person' | 'app' | 'default'`), when it declared one. */
  readonly origin?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A recorded occurrence owns its rewrites. Only a keyless row can use a provider ID. */
export function rewriteCallAddress(row: { readonly toolCallId?: unknown }): string | undefined {
  const occurrence = readCallOccurrenceKey(row);
  if (occurrence === null) return undefined;
  if (occurrence !== undefined) return `occurrence:${occurrence}`;
  return typeof row.toolCallId === 'string' ? `legacy:${row.toolCallId}` : undefined;
}

// FOLD · the one owner of "which argument of which call a before-tool rewrite superseded"
// consumers read this and never re-derive it: assessment/assess.ts · readArgumentVerdicts,
// arguments/serve/assumed.ts · assumedBlockOf
// detached: yes — fresh maps of plain entries, rebuilt per read.
/**
 * The before-tool middleware rewrites on the record — `middlewareDecisions`
 * rows at `'tool'` that carry `changedKeys` — grouped by the resolved call and
 * then by argument. The LAST rewrite wins because the call ran with that
 * chain link's value. Witnesses keep their original decision row index.
 */
export function argumentRewritesOf<Address>(
  decisions: unknown,
  addressOf: (row: Readonly<Record<string, unknown>>) => Address | undefined,
): ReadonlyMap<Address, ReadonlyMap<string, ArgumentRewrite>> {
  const byCall = new Map<Address, Map<string, ArgumentRewrite>>();
  if (!Array.isArray(decisions)) return byCall;
  decisions.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.at !== 'tool' || !Array.isArray(row.changedKeys)) return;
    const address = addressOf(row);
    if (address === undefined) return;
    const from = isRecord(row.from) ? row.from : {};
    const forCall = byCall.get(address) ?? new Map<string, ArgumentRewrite>();
    for (const key of row.changedKeys as readonly unknown[]) {
      if (typeof key !== 'string') continue;
      const origin = from[key];
      forCall.set(key, { index, ...(typeof origin === 'string' && { origin }) });
    }
    byCall.set(address, forCall);
  });
  return byCall;
}
