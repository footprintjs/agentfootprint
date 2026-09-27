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
 *          `stages/toolCalls.ts` · `withChangedKeys`) and, when the middleware
 *          declared one, where each value came from
 *          (`allow(args, why, { from })`). The layer checked the value BEFORE
 *          the chain ran, so a rewrite supersedes the layer's row: the value
 *          the call ran with is the rewrite's. Two readers must agree on that —
 *          `assessment/assess.ts` · `readArgumentVerdicts` (the standing) and
 *          `stages/prepareFinal.ts` · `assumedLinesOf` (the "Assumed" block) —
 *          and the fold loads through `import()`, so the final branch cannot
 *          import it: the reading lives here, once.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * argumentRewritesOf([
 *   { at: 'tool', toolCallId: 'c1', changedKeys: ['window'], from: { window: 'person' }, … },
 * ]).get('c1')?.get('window'); // { index: 0, origin: 'person' }
 * ```
 */

/** A before-tool rewrite of one argument — the last per (call, argument). */
export interface ArgumentRewrite {
  /** Where the rewrite's row sits in `middlewareDecisions` — the witness a reader points at. */
  readonly index: number;
  /** The middleware's declared origin for the argument (`'person' | 'app' | 'default'`), when it declared one. */
  readonly origin?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// FOLD · the one owner of "which argument of which call a before-tool rewrite superseded"
// consumers read this and never re-derive it: assessment/assess.ts · readArgumentVerdicts,
// stages/prepareFinal.ts · assumedLinesOf
// detached: yes — fresh maps of plain entries, rebuilt per read.
/**
 * The before-tool middleware rewrites on the record — `middlewareDecisions`
 * rows at `'tool'` that carry `changedKeys` — keyed by call, then argument,
 * the LAST rewrite winning, because the value the call ran with is the last
 * link's. Anything that is not such a row is skipped.
 */
export function argumentRewritesOf(
  decisions: unknown,
): ReadonlyMap<string, ReadonlyMap<string, ArgumentRewrite>> {
  const byCall = new Map<string, Map<string, ArgumentRewrite>>();
  if (!Array.isArray(decisions)) return byCall;
  decisions.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.at !== 'tool' || !Array.isArray(row.changedKeys)) return;
    const toolCallId = row.toolCallId;
    if (typeof toolCallId !== 'string') return;
    const from = isRecord(row.from) ? row.from : {};
    const forCall = byCall.get(toolCallId) ?? new Map<string, ArgumentRewrite>();
    for (const key of row.changedKeys as readonly unknown[]) {
      if (typeof key !== 'string') continue;
      const origin = from[key];
      forCall.set(key, { index, ...(typeof origin === 'string' && { origin }) });
    }
    byCall.set(toolCallId, forCall);
  });
  return byCall;
}
