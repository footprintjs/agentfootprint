/**
 * compaction — keep the live window inside budget without ever losing the
 * record.
 *
 * The one sentence: **compaction edits the WINDOW, never the LEDGER.** Folded
 * turns stay in the commit log verbatim; the summary enters as its own
 * recorded step naming every `runtimeStageId` it folded. A summary is a claim
 * about the past, so this library files it as a claim — not as the past.
 *
 * Public surface (re-exported from the package root):
 *   `CompactionOptions`   what `.compaction()` accepts
 *   `CompactionRecord`    what each over-budget visit wrote to the ledger
 *   `FoldRefusal(Reason)` why a turn refused to fold
 *   `CompactionUnmeasurableError` the refusal for a provider that reports no usage
 */

export { CompactionUnmeasurableError } from './errors.js';
export type {
  CompactionOptions,
  CompactionRecord,
  FoldRefusal,
  FoldRefusalReason,
  ResolvedCompaction,
} from './types.js';
export { COMPACTED_FRAME_PREFIX, isCompactedSummary } from './summarize.js';
