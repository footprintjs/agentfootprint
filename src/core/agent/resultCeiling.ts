/**
 * resultCeiling — the refusing ceiling a tool declares on its OWN result
 * (9.20.0). One owner of the measurement and the refusal sentence; the
 * tool-dispatch loop (`stages/toolCalls.ts`) calls it at every boundary where
 * a handler's return becomes final, so a resumed call is refused exactly as an
 * inline one.
 *
 * Pattern: measured refusal at the dispatch boundary — the sibling of
 *          `toolResultCap.ts`, with the OPPOSITE answer to overflow, because
 *          the two serve different owners:
 *
 *   • `maxToolResultChars` (agent-level, 9.11.0) TRUNCATES: the operator caps
 *     tools they did not write, so the most honest deliverable is a marker
 *     plus a verbatim head of whatever came back.
 *   • `resultCeiling` (per-tool, this module) REFUSES: the AUTHOR declared
 *     what a sane result is and which parameters (`narrowBy`) make a retry
 *     smaller. A truncated result reads as a complete one — the model cannot
 *     tell the data ends where the cut happened and fabricates from the part
 *     it saw — while a refusal that says "No data was returned" and names the
 *     narrowing parameters produces a clean retry (field-verified on a
 *     ~191k-char return).
 *
 * The oversized payload never leaves the dispatch: not into history, not into
 * `stream.tool_end`, not into any recorder. The RECORD keeps the truth as the
 * typed `agentfootprint.tools.result_refused` event (true size, ceiling,
 * suggestions), emitted by the caller beside the replacement; the delivered
 * result carries status `'invalid'` — the closed-set member whose corrective
 * action is "fix the call" — so `onToolStatus` edges can route on it.
 *
 * Emits: nothing itself (pure measurement); zero-cost-when-unused — no
 * declared ceiling means one `undefined` check and byte-identical behavior.
 */

import type { ToolResultCeiling } from '../tools.js';
import { safeStringify } from './validators.js';

/** What an over-ceiling measurement hands the dispatch loop: the sentence the
 *  model reads and the true size for the record. `undefined` from
 *  {@link applyResultCeiling} means no ceiling or under it — untouched path. */
export interface ResultCeilingRefusal {
  /** The teaching refusal — the ONLY thing the model (and every downstream
   *  channel) receives in place of the oversized payload. */
  readonly refusal: string;
  /** The stringified result's true length — the record's fact, carried by the
   *  `tools.result_refused` event, never by any content channel. */
  readonly sizeChars: number;
}

/**
 * Measure one handler result against the tool's declared ceiling.
 *
 * Returns `undefined` when there is no ceiling or the result fits — the caller
 * keeps every byte of today's path. Over the ceiling, returns the refusal to
 * deliver INSTEAD of the payload. What is measured is the string the model
 * would have read (strings as-is, everything else `safeStringify`d) — the same
 * rule `toolResultCap.ts` measures by, so the two ceilings always argue about
 * the same number.
 */
export function applyResultCeiling(
  value: unknown,
  opts: { readonly toolName: string; readonly ceiling: ToolResultCeiling | undefined },
): ResultCeilingRefusal | undefined {
  const ceiling = opts.ceiling;
  if (ceiling === undefined) return undefined;
  const text = typeof value === 'string' ? value : safeStringify(value);
  if (text.length <= ceiling.maxChars) return undefined;
  const narrow =
    ceiling.narrowBy !== undefined && ceiling.narrowBy.length > 0
      ? ` — e.g. pass ${ceiling.narrowBy.map((n) => `'${n}'`).join(', ')}`
      : '';
  return {
    refusal:
      `Result too large: ${opts.toolName} returned ${text.length} chars, over its declared ` +
      `${ceiling.maxChars}-char ceiling. Narrow the request and call again${narrow}. ` +
      `No data was returned.`,
    sizeChars: text.length,
  };
}
