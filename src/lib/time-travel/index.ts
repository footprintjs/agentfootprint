/**
 * time-travel/ — the agent's stops on a reader's cursor, and what the model
 * was handed at each of them.
 *
 * Role: Fold. See README.md for what a milestone stop is, what a receipt and a
 * served view are, and how one strategy and one epoch owner serve both chart
 * shapes.
 */

export { milestoneOf, milestoneStops, milestoneStopsStrategy } from './milestoneStops.js';
export {
  epochAt,
  epochLocations,
  llmCallMountKeys,
  readAfterCall,
  readAtCall,
  readRunConstant,
  recordingOf,
  type EpochLocation,
  type RecordingLike,
} from './epochs.js';
export { keyedFold, type FoldBasis, type FoldSourceLike, type KeyedFold } from './keyedFold.js';
export {
  buildReceipt,
  messageDigestInput,
  receiptHash,
  stableJson,
  FORCED_OUTPUT_TOOL_KEY,
  RECEIPT_BOUNDARY,
  RECEIPT_HASH_CHARS,
  RECEIPT_KEY,
  UNSERIALIZABLE,
  type Receipt,
  type ReceiptAttentionOmission,
  type ReceiptCacheMarker,
  type ReceiptMessage,
  type ReceiptParams,
  type ReceiptPiece,
  type ReceiptRequestOnlyMessage,
} from './receipt.js';
export { sha256Hex } from './sha256.js';
export {
  receiptAt,
  servedAt,
  servedViews,
  SERVED_GAPS,
  UNGAPPED_FIELDS,
  type ServedGap,
  type ServedGapCause,
  type ServedGapKind,
  type ServedPiece,
  type ServedRequestOnly,
  type ServedView,
} from './servedView.js';
