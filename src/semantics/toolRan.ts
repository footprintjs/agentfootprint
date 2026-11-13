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
 *   `emitToolEnd`, the door every `tool_end` of the Agent's tool-call stages
 *   passes, stamps the field from the `ran` flag every dispatch path already
 *   hands it. One other emitter writes `tool_end` without it: the demo chart
 *   `core/agent/buildAgentMessageApiChart.ts` · `toolExec`, which runs no tool
 *   function at all (it answers `[name result]` for any name), so its brackets
 *   read `'ran'` here and prove nothing about a tool.
 * - `toolRanOf` is the reader: the answer account (`answer-account/facts/
 *   calls.ts` · `outcomeOf`), the tool-call ledger (`answer-validation/
 *   toolLedger.ts` · `toolOutcomeOf`), the trace toolpack
 *   (`trace-toolpack/traceToolpack/toolCallJournal.ts`) and the chat-interface
 *   door (`ag-ui/toolResultWords.ts`) ask it. Readers that do not ask it yet
 *   are listed in `answer-account/README.md`, "Not covered yet".
 *
 * What the field proves, on a record written by this version:
 *   - `entered: false` — the tool's function was never entered. Stamped on
 *     every bracket of such a call, except one that already says so another
 *     way (`notExecuted`: a rule refused it; `notDispatched`: a paused batch
 *     settled it), which keeps the bytes it had.
 *   - `entered: true`  — the function was entered AND the call ended in an
 *     error (`error: true`). Only beside `error`.
 *   - absent, on a bracket with no `notExecuted` and no `notDispatched` — a
 *     call that ended without `error` and whose function was entered: a
 *     success keeps exactly the bytes it always had. (A bracket WITH one of
 *     those markers has no `entered` either, and its function was not
 *     entered: the marker says so.)
 *
 * A record written BEFORE this version carries no `entered` anywhere, so
 * there its absence proves nothing: an `error` bracket without it reads
 * `'not-recorded'`. A bracket without `error` and without any marker reads
 * `'ran'` on a record of any version; on an older record a resumed leg's call
 * that a person declined or a rule refused also looks like that, and the
 * account tells it apart by its `checkin.decision` / `middleware.decision`
 * row, which it reads first.
 *
 * The same fact has a second spelling on the conversation history, which
 * carries no `tool_end`: `LLMMessage.toolResultOrigin: 'not-entered'`,
 * written under findings admission and on hosting notices. This reader does
 * not read history; it reads brackets only.
 *
 * Zone: a zero-import leaf (type-only shapes, declared here, so the event
 * payload module stays free of code).
 *
 * @example
 *   toolRanOf({ error: true, entered: false }) // 'not-run'     — an unknown tool name
 *   toolRanOf({ error: true, entered: true })  // 'ran'         — the tool threw
 *   toolRanOf({ error: true })                 // 'not-recorded' — written before this version
 *   toolRanOf({ error: 'yes' })                // 'not-recorded' — a leaf no writer writes
 *   toolRanOf({})                              // 'ran'         — it returned
 */

/** The answer to "did this call's tool run?" read off its `tool_end` bracket. */
export type ToolRan = 'ran' | 'not-run' | 'not-recorded';

/**
 * The `tool_end` fields the answer is read from — nothing else of the bracket.
 * Typed `unknown` because a reader hands in a SAVED record, which is data:
 * each is compared to `true` / `false` exactly. A present `error`, `entered`
 * or `notExecuted` leaf that is not a boolean is not a value any writer
 * writes (a hand-edited record, a placeholder), so the bracket reads
 * `'not-recorded'`: such a leaf never proves that a tool ran or did not run.
 */
export interface ToolRanFields {
  readonly error?: unknown;
  readonly entered?: unknown;
  readonly notExecuted?: unknown;
  readonly notDispatched?: unknown;
}

/** A leaf that is present but not a boolean: the record does not say. */
const unreadable = (leaf: unknown): boolean => leaf !== undefined && typeof leaf !== 'boolean';

/**
 * THE reader. Markers first (each proves "did not run" on its own), then the
 * stamp, then the leaves no writer writes, then the version gap: an `error`
 * with no stamp is a record that does not say.
 */
export function toolRanOf(bracket: ToolRanFields): ToolRan {
  if (bracket.notDispatched !== undefined) return 'not-run';
  if (bracket.notExecuted === true) return 'not-run';
  if (bracket.entered === false) return 'not-run';
  if (bracket.entered === true) return 'ran';
  if ([bracket.entered, bracket.error, bracket.notExecuted].some(unreadable)) return 'not-recorded';
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
