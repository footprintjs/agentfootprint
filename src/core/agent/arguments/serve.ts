/**
 * arguments/serve — what the inputs layer says, and to whom.
 *
 * Pattern: Lens. Pure composers, one per served surface: the ruled tool's
 *          SCHEMA (a rebuilt copy per request, never the registry reference),
 *          the past-tense NOTE on a result whose call ran on a filled value
 *          (a declared default, or the person's answer to the batch ask), the
 *          REFUSALS a call reads when it does not run, and the "Assumed"
 *          block under an existing `.limitsTravelWithTheAnswer()`.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). Every
 *          sentence here is registered in `test/modelFacingSurfaces.test.ts`:
 *          it says what the model may do and what the record keeps, and
 *          promises no outcome a later path can break. Loaded through
 *          `import()` by every static site that serves one of them — the
 *          tools slot and seed (the schema), ToolCalls through
 *          `dispatch.ts` (the note, the refusal), the final branch's armed
 *          variant (the block) — and only under the arm: the optional-family
 *          law of docs-next's site budget, so a plain agent's graph never
 *          carries this module.
 * Emits:   N/A.
 *
 * ## The value in a sentence goes through the tool's own view
 *
 * A served schema and a served tool message are both part of the record. When
 * the tool's argument view (`core/toolShownArgs.ts` · `shownArgsOf`) hides a
 * ruled argument, no sentence here prints its value — it says the value is
 * hidden by the tool's view instead.
 */

export { printedValue, assumeSentence } from './serve/values.js';
export {
  ASK_SENTENCE,
  ASK_SOURCES_SENTENCE,
  withArgumentRules,
  rulesOnWire,
} from './serve/schema.js';
export type { ServeOptions } from './serve/schema.js';
export { timeWindowsLine } from './serve/windows.js';
export type { ServedWindows } from './serve/windows.js';
export {
  timeLimitsLine,
  timeLimitsSentence,
  UNKNOWN_ZONE_CLAUSE,
  clockSentence,
  TIME_LINE_SOURCE,
  timeLine,
} from './serve/clock.js';
export type { ServedClock } from './serve/clock.js';
export { filledNote, ANSWERED_SOURCE_CLAUSE } from './serve/fills.js';
export type { FilledArgument } from './serve/fills.js';
export {
  unreadableRulesRefusal,
  unmountedRulesRefusal,
  unansweredRefusal,
  secondPauseRefusal,
  timeRefusal,
  keptAnswersNote,
} from './serve/refusals.js';
export {
  ASSUMED_BLOCK_HEADING,
  assumedBlock,
  assumedBlockOf,
  assumedLinesFor,
} from './serve/assumed.js';
export type { AssumedLine } from './serve/assumed.js';
