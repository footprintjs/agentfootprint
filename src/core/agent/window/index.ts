/**
 * window — the window-strategy family: keep the live context window inside
 * its budget without ever losing the record.
 *
 * The one sentence: **a window strategy edits the WINDOW, never the LEDGER.**
 * Removed turns stay in the commit log verbatim; the strategy files its own
 * recorded step naming every `runtimeStageId` whose messages left. A summary
 * is a claim about the past, so this library files it as a claim — not as the
 * past. A drop is an absence, and it is named the same way.
 *
 * A commit log lives as long as the process. A conversation lives longer, so
 * `.compaction({ retain })` also carries the folded originals on the
 * conversation checkpoint — `foldedSpanFor(conversation, message)` is the door
 * back to them, in this process or the one after the deploy.
 *
 * Three strategies ship, all sharing one turn segmentation and one refusal
 * engine:
 *   `summarizeOldest`  fold the oldest span into a summary (`.compaction()`)
 *   `slidingWindow`    keep the last N turns, drop older ones
 *   `tokenBudget`      counted-token trigger, drop instead of summarize
 *
 * Public surface (re-exported from the package root).
 */

export { CompactionUnmeasurableError } from './errors.js';
export type {
  CompactionOptions,
  CompactionRecord,
  CompactionRetention,
  FoldedSpan,
  ResolvedCompaction,
  SlidingWindowOptions,
  SlidingWindowRecord,
  TokenBudgetOptions,
  TokenBudgetRecord,
  WindowObservations,
  WindowRecord,
  WindowRefusal,
  WindowRefusalReason,
} from './types.js';
export { foldedMessages, foldedSpanFor, type FoldedConversation } from './folded.js';
export type {
  RemovalFacts,
  WindowEviction,
  WindowStrategy,
  WindowStrategyInput,
  WindowStrategyResult,
} from './strategy.js';
export type { RemovalPlan, Turn } from './turns.js';
export { COMPACTED_FRAME_PREFIX, isCompactedSummary } from './summarize.js';
export { DROP_NOTICE_PREFIX, isDropNotice } from './notice.js';
export { summarizeOldest } from './strategies/summarizeOldest.js';
export { slidingWindow } from './strategies/slidingWindow.js';
export { tokenBudget } from './strategies/tokenBudget.js';
