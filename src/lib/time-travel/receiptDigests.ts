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
 * agent never carries one run's strings into the next.
 *
 * Within a run, the two string memos (BY PREIMAGE, and the transform chain's
 * links) keep TWO CALLS' worth — the call being minted and the one before it.
 * Each `forRun` is one mint, and it rotates them. A piece that repeats from one
 * call to the next (a system prompt, a tool schema, the chain's prefix) is
 * found; a piece that changes every call (a system prompt with the time in it)
 * is not kept past the next call. What the memo holds is bounded by two
 * requests' worth — their non-message pieces and one chain link per message —
 * never by how many calls the run made. The BY OBJECT memo is weak — it lives
 * as long as the message objects do.
 *
 * ── TOTAL ───────────────────────────────────────────────────────────────────
 * A receipt is bookkeeping and must never stop a run. A message whose fields
 * cannot be read (a throwing getter on an object a caller handed in) is not
 * memoized: `message()` hands back a fresh, unkept record and the mint derives
 * everything from the message as it would with no memo at all.
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
  /** @internal Strings the two string memos hold right now — pinned by
   *  test/lib/time-travel/receipt-incremental.test.ts (bounded by two calls). */
  retained(): number;
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
// keeps them alive) and the preimage strings of the last two calls.
/** Start an empty memo. See {@link ReceiptDigests}. */
export function createReceiptDigests(): ReceiptDigests {
  let current: (RunDigests & { readonly nextCall: () => void }) | undefined;
  return {
    forRun(runId) {
      if (current === undefined || current.runId !== runId) current = runDigests(runId);
      else current.nextCall();
      return current;
    },
  };
}

interface MessageEntry {
  readonly keys: readonly string[];
  readonly values: readonly unknown[];
  readonly digests: MessageDigests;
}

function runDigests(runId: string): RunDigests & { readonly nextCall: () => void } {
  const byPreimage = twoCalls();
  const links = twoCalls();
  const byObject = new WeakMap<object, MessageEntry>();
  const message = (value: object): MessageDigests => {
    try {
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
    } catch {
      return {}; // unreadable: derive everything afresh, keep nothing (see TOTAL)
    }
  };
  return {
    runId,
    hash: (preimage, compute) => byPreimage.get(preimage, compute),
    message,
    measureOf: (value) => message(value).measure,
    keep: (value, measure) => {
      message(value).measure = measure;
    },
    link: (previous, digest, compute) => links.get(`${previous}\u001F${digest}`, compute),
    retained: () => byPreimage.size() + links.size(),
    nextCall: () => {
      byPreimage.rotate();
      links.rotate();
    },
  };
}

/**
 * A string memo that keeps the current call's entries and the previous call's,
 * nothing older — see LIFETIME. A hit in the previous call's entries is carried
 * into the current one.
 */
function twoCalls() {
  let current = new Map<string, string>();
  let previous = new Map<string, string>();
  return {
    get(key: string, compute: () => string): string {
      let value = current.get(key);
      if (value === undefined) {
        value = previous.get(key) ?? compute();
        current.set(key, value);
      }
      return value;
    },
    rotate(): void {
      previous = current;
      current = new Map();
    },
    size: (): number => current.size + previous.size,
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
