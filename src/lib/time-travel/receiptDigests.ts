/**
 * receiptDigests — what a run's receipts have already hashed, so each piece of
 * a request is hashed ONCE per run instead of once per call.
 *
 * Role:  Memo. A plain data structure the receipt mint (`receipt.ts` ·
 *        `buildReceipt`) reads and fills; it hashes nothing itself, reads no
 *        scope and emits nothing.
 * Reads: what the mint hands it.
 * Emits: N/A.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * An agent's request at call k is the request at call k−1 plus what the loop
 * appended — and the mint used to hash every message of it again, on every
 * call. Measured on an agent run with 1,000-row tool results: SHA-256 input
 * grew with the square of the iteration count, and the mint was the largest
 * single cost of the run (63% of its CPU at 40 iterations, under a caching
 * provider). The digests themselves never needed to change: a receipt's hashes
 * are functions of the bytes, so a message hashed at call 3 has the same hash
 * at call 30. This keeps them.
 *
 * ── THE TWO LOOKUPS ─────────────────────────────────────────────────────────
 *   BY PREIMAGE  `hash(preimage)` — the salted hashes of the per-call pieces
 *                that are not messages (system text, system pieces, tool
 *                schemas), keyed by the exact string that was hashed. Exact by
 *                construction: a hash is a function of its preimage, so a hit
 *                returns what recomputing would return.
 *   BY OBJECT    `message(m)` — what was derived from one message OBJECT: its
 *                entry hash, its transform-chain digest, whether it serializes,
 *                and its request measurement (`requestMeasurement.ts`), so a
 *                message the run has already seen costs no string building at
 *                all. It keeps DIGESTS and counts, never a copy of the message's
 *                text — a 1,000-row tool result is not held twice. Valid only while
 *                the object's own fields are the values they were: every field
 *                is compared by identity on each hit, and a mismatch derives
 *                again. Committed state is never edited in place (footprintjs's
 *                immutable-after-swap law), so a hit is the common case — the
 *                agent's history hands the mint the same message objects call
 *                after call.
 *
 * ── WHAT IT DOES NOT CHANGE ─────────────────────────────────────────────────
 * Every hash a receipt carries is the hash it carried before this memo existed:
 * same preimage, same salt, same digest. A receipt minted with the memo and one
 * minted without it are byte-identical, and so is the request measurement —
 * pinned by test/lib/time-travel/receipt-incremental.test.ts.
 *
 * The one assumption a hit makes: a message's NESTED values (`toolCalls`,
 * `args`, `thinkingBlocks`) are not edited in place while the message object
 * is reused. The agent's history is committed state, which is never edited in
 * place; a caller that hands the mint its own objects and then mutates one
 * deep inside must hand a new object instead.
 *
 * ── LIFETIME ────────────────────────────────────────────────────────────────
 * One memo per run, bound to the run id (the salt). `forRun` hands back the
 * current run's memo, and a different run id starts a fresh one — so a reused
 * agent never carries one run's strings into the next, and nothing here grows
 * past one run.
 */

import type { MessageMeasure, MessageMeasureCache } from './requestMeasurement.js';

/** What one message object has already been turned into. */
export interface MessageDigests {
  /** `messageDigestInput(m)` hashed — the receipt's `messages.entries[].hash`. */
  entryHash?: string;
  /**
   * Whether `stableJson([m])` — the message as one array element — produced a
   * value. Read by the cache comparison, which is `'unknown'` when a message
   * cannot be serialized.
   */
  serializable?: boolean;
  /** `H(stableJson([m]) ?? UNSERIALIZABLE)` — the transform chain's digest of
   *  this message (`receipt.ts` · `transformHashOf`). Kept as the digest, never
   *  as the JSON, so the memo holds no copy of a message's text. */
  elementDigest?: string;
  /** The message as `measureRequest` measured it at a request's
   *  `messages[i]` (`requestMeasurement.ts` · `MessageMeasure`). */
  measure?: MessageMeasure;
}

/** One run's memo. */
export interface RunDigests extends MessageMeasureCache {
  /** The run id every hash in this memo is salted with. */
  readonly runId: string;
  /** The salted hash of `preimage`, computed by `compute` the first time only. */
  hash(preimage: string, compute: () => string): string;
  /** What has been derived from `message` while its fields are unchanged. */
  message(message: object): MessageDigests;
  /** The chain link after `previous` and `digest` — see `receipt.ts` ·
   *  `transformHashOf`. Computed by `compute` the first time only. */
  link(previous: string, digest: string, compute: () => string): string;
}

/**
 * A memo the receipt mint keeps across the calls of a run. Create one per
 * agent; it rebinds itself when the run id changes.
 *
 * @example
 * ```ts
 * const digests = createReceiptDigests();
 * buildReceipt(callOne, digests);   // hashes every piece
 * buildReceipt(callTwo, digests);   // hashes only what call two added
 * ```
 */
export interface ReceiptDigests {
  /** The memo for `runId` — the current one, or a fresh one for a new run. */
  forRun(runId: string): RunDigests;
}

// FOLD · the one owner of "already hashed this run": buildReceipt reads it, and
// nothing else re-derives a receipt digest across calls
// detached: no — it holds the message objects of the run as WeakMap keys (never
// keeps them alive) and the preimage strings it hashed.
/** Start an empty memo. See {@link ReceiptDigests}. */
export function createReceiptDigests(): ReceiptDigests {
  let current: RunDigests | undefined;
  return {
    forRun(runId) {
      if (current === undefined || current.runId !== runId) current = runDigests(runId);
      return current;
    },
  };
}

interface MessageEntry {
  readonly keys: readonly string[];
  readonly values: readonly unknown[];
  readonly digests: MessageDigests;
}

function runDigests(runId: string): RunDigests {
  const byPreimage = new Map<string, string>();
  const byObject = new WeakMap<object, MessageEntry>();
  const links = new Map<string, string>();
  const message = (value: object): MessageDigests => {
    const keys = Object.keys(value);
    const held = byObject.get(value);
    if (held !== undefined && sameFields(held, value, keys)) return held.digests;
    const entry: MessageEntry = {
      keys,
      values: keys.map((key) => (value as Record<string, unknown>)[key]),
      digests: {},
    };
    byObject.set(value, entry);
    return entry.digests;
  };
  return {
    runId,
    hash(preimage, compute) {
      let value = byPreimage.get(preimage);
      if (value === undefined) {
        value = compute();
        byPreimage.set(preimage, value);
      }
      return value;
    },
    message,
    measureOf: (value) => message(value).measure,
    keep: (value, measure) => {
      message(value).measure = measure;
    },
    link(previous, digest, compute) {
      const key = `${previous}\u001F${digest}`;
      let value = links.get(key);
      if (value === undefined) {
        value = compute();
        links.set(key, value);
      }
      return value;
    },
  };
}

/** Are `message`'s own fields still exactly the values `held` saw? Identity per
 *  field — a field that is a new object is a different field, even when equal. */
function sameFields(held: MessageEntry, message: object, keys: readonly string[]): boolean {
  if (keys.length !== held.keys.length) return false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (key !== held.keys[i]) return false;
    if ((message as Record<string, unknown>)[key] !== held.values[i]) return false;
  }
  return true;
}
