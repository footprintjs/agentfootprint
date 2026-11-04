import {
  readAfterCall,
  readAtCall as foldAtCall,
  readRunConstant as foldRunConstant,
  type EpochLocation,
} from '../epochs.js';
import type { StoredReceipt } from '../../core/agent/receipt/receipt.js';
import { RECEIPT_KEY } from '../../lib/conventions.js';
import type { ServedGapCause } from '../servedView.js';

/**
 * The commit log's redaction placeholder (footprintjs writes it where a run's
 * policy selected a key — `Agent.create({ redact })`). To this rebuild it is NO
 * value: never a system piece, a tool list or a tool name the view could print
 * as if the request had carried it. Read as absent, which is what the record
 * can show. The view states the cost through the gap a redacted snapshot always
 * carries: it travels without its fold base (footprintjs omits `initialState`
 * from the served view), so `no-fold-base` — "unproven and may be SHORT … reads
 * as empty rather than as unknown" — is on every view of it.
 *
 * Read so only when the record says a policy covered the run — the snapshot's
 * marker (`redaction/marker.ts` · `servedUnderPolicy`), asked once per call of
 * `servedAt` / `servedViews` — so a value that merely spells the word (a tool
 * NAMED `REDACTED`) is a value on a run no policy covered, as the answer
 * account and `assessAnswer` read it.
 */
const LOG_PLACEHOLDER = 'REDACTED';

/** {@link https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/epochs.ts | epochs.readAtCall}, with the placeholder read as absent on a `served` record. */
export function readAtCall(location: EpochLocation, key: string, served: boolean): unknown {
  const value = foldAtCall(location, key);
  return served && value === LOG_PLACEHOLDER ? undefined : value;
}

/** {@link https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/epochs.ts | epochs.readRunConstant}, with the placeholder read as absent on a `served` record. */
export function readRunConstant(location: EpochLocation, key: string, served: boolean): unknown {
  const value = foldRunConstant(location, key);
  return served && value === LOG_PLACEHOLDER ? undefined : value;
}

/** The receipt, or the reason there is none — the shape `readReceipt` answers
 *  in. */
type ReceiptRead =
  | { readonly receipt: StoredReceipt; readonly cause?: undefined }
  | { readonly receipt?: undefined; readonly cause: ServedGapCause };

/**
 * The receipt this epoch's call committed, or WHY there is none. Shared by
 * `receiptAt` and by the rebuild, which reads exactly TWO things off a receipt
 * — the model/provider/runId basis, and whether a cache strategy stood between
 * assembly and the port — and nothing else.
 *
 * THE ONE PLACE THAT KNOWS. This function is where the difference between
 * "nothing was committed" and "something was committed and it is not a
 * receipt" exists at all: everywhere else the two are one `undefined`. It used
 * to be spent here, and the gap's printed sentence tried to make it up
 * afterwards from a list of causes — which is how a shape refusal added in this
 * release became a cause that sentence had already ruled out. So the answer
 * carries the reason out, and {@link https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedView.ts | ServedGap.cause} is where it lands.
 *
 * THE ONE PLACE THAT NARROWS, too — and what it admits is what it says it
 * admits. The check is the basis and nothing past it, so the value it hands
 * back is a {@link StoredReceipt}: every container past the basis is what the
 * MINTING release wrote, and a reader behind this narrowing reads them as
 * optional, because the type says so and the compiler holds it to that.
 * 9.93.0 read `receipt.cache.strategy` off a `Receipt` here — the minted
 * shape, which promises `cache` — and a stored receipt with a basis and no
 * `cache` made `servedAt` throw where 9.92 built a view. A reader reads the
 * receipt it is handed; a missing container is a fact about the vintage,
 * never a throw. It is also never repaired: nothing here fabricates a
 * `cache: {}` or writes to the record.
 */
export function readReceipt(location: EpochLocation): ReceiptRead {
  const value = readAfterCall(location, RECEIPT_KEY);
  // Nothing under the key: the run never minted one here. The record does not
  // say which of the ways that happens applied, and neither does this.
  if (value === undefined) return { cause: 'no-receipt-committed' };
  // Something IS under the key. A value without a basis is not a receipt —
  // refuse it rather than hand back a half-shape a caller would read
  // `.basis.runId` off — and REPORT the refusal, because a log that holds a
  // non-receipt under the receipt key is damaged, which is a different fact
  // about the recording from a run that never minted.
  const candidate = value as Partial<StoredReceipt>;
  if (value === null || typeof value !== 'object' || typeof candidate.basis?.epoch !== 'number') {
    return { cause: 'receipt-shape-rejected' };
  }
  return { receipt: value as StoredReceipt };
}
