/**
 * toolRan — did a tool call's function run? The ONE law, both halves.
 *
 * WHY. A call can end in an error without its tool ever running: the model
 * named a tool that does not exist, its arguments failed the schema, a
 * credential was blocked. Before `entered`, its `stream.tool_end` bracket said
 * `error: true` and nothing else, the same bytes as a tool that ran and threw,
 * so the answer account told a person "It ran reboot_host" for a tool name
 * that does not exist. The dispatch always KNEW the difference (it sets its
 * `executed` flag just before `execute` is entered); the bracket now carries
 * it, and every reader asks this module instead of guessing from `error`.
 *
 * - `withEntered` is the writer: `observation/observationsOperations.ts` ·
 *   `emitToolEnd`, the one door every `tool_end` passes, stamps the field from
 *   the `ran` flag every dispatch path already hands it.
 * - `toolRanOf` is the reader: the answer account (`answer-account/facts/
 *   calls.ts` · `outcomeOf`) and the tool-call ledger (`answer-validation/
 *   toolLedger.ts` · `toolOutcomeOf`) ask it.
 *
 * What the field proves, on a record written by this version:
 *   - `entered: false` — the tool's function was never entered. Stamped on
 *     every bracket of such a call, except one that already says so another
 *     way (`notExecuted`: a rule refused it; `notDispatched`: a paused batch
 *     settled it), which keeps the bytes it had.
 *   - `entered: true`  — the function was entered AND the call ended in an
 *     error (`error: true`). Only beside `error`.
 *   - absent           — a call that ended without `error` and whose function
 *     was entered: a success keeps exactly the bytes it always had.
 *
 * A record written BEFORE this version carries no `entered` anywhere, so
 * there its absence proves nothing: an `error` bracket without it reads
 * `'not-recorded'`. A bracket without `error` and without any marker reads
 * `'ran'` on a record of any version; on an older record a resumed leg's call
 * that a person declined or a rule refused also looks like that, and the
 * account tells it apart by its `checkin.decision` / `middleware.decision`
 * row, which it reads first.
 *
 * Zone: a zero-import leaf (type-only shapes, declared here, so the event
 * payload module stays free of code).
 *
 * @example
 *   toolRanOf({ error: true, entered: false }) // 'not-run'     — an unknown tool name
 *   toolRanOf({ error: true, entered: true })  // 'ran'         — the tool threw
 *   toolRanOf({ error: true })                 // 'not-recorded' — written before this version
 *   toolRanOf({})                              // 'ran'         — it returned
 */

/** The answer to "did this call's tool run?" read off its `tool_end` bracket. */
export type ToolRan = 'ran' | 'not-run' | 'not-recorded';

/**
 * The `tool_end` fields the answer is read from — nothing else of the bracket.
 * Typed `unknown` because a reader hands in a SAVED record, which is data: each
 * is compared to `true` / `false` exactly, so a leaf that is not a boolean
 * reads as absent and can never prove that a tool ran.
 */
export interface ToolRanFields {
  readonly error?: unknown;
  readonly entered?: unknown;
  readonly notExecuted?: unknown;
  readonly notDispatched?: unknown;
}

/**
 * THE reader. Markers first (each proves "did not run" on its own), then the
 * stamp, then the version gap: an `error` with no stamp is a record that does
 * not say.
 */
export function toolRanOf(bracket: ToolRanFields): ToolRan {
  if (bracket.notDispatched !== undefined) return 'not-run';
  if (bracket.notExecuted === true) return 'not-run';
  if (bracket.entered === false) return 'not-run';
  if (bracket.entered === true) return 'ran';
  if (bracket.error === true) return 'not-recorded';
  return 'ran';
}

/**
 * THE writer. `ran` is the dispatch's own fact: the tool's `execute` was
 * entered. Returns `bracket` itself when nothing is stamped (a success, or a
 * bracket another marker already explains), so those bytes cannot move.
 *
 * @example withEntered({ toolCallId: 'c1', result: 'Unknown tool…', durationMs: 0, error: true }, false)
 *   // → { …, error: true, entered: false }
 */
export function withEntered<T extends ToolRanFields>(bracket: T, ran: boolean): T {
  if (bracket.notDispatched !== undefined || bracket.notExecuted === true) return bracket;
  if (!ran) return { ...bracket, entered: false };
  return bracket.error === true ? { ...bracket, entered: true } : bracket;
}
