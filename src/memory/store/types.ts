/**
 * MemoryStore — the I/O boundary.
 *
 * Every storage backend (InMemory, Redis, DynamoDB, Postgres, Bedrock
 * AgentCore) implements this interface. Stages above the store layer never
 * talk to a concrete backend — they invoke these methods and trust the
 * adapter to handle durability, consistency, encryption, pagination, etc.
 *
 * Design principles:
 *
 * 1. **Identity is always the first argument.** Every call takes
 *    `MemoryIdentity` so stores enforce tenant / principal isolation at
 *    the boundary. A bug passing the wrong identity surfaces as "no data"
 *    rather than a cross-tenant leak.
 *
 * 2. **Methods return Promises uniformly.** Even InMemoryStore's sync ops
 *    are wrapped — stages can await every call and adapters are free to
 *    swap sync ↔ async without breaking callers.
 *
 * 3. **Writes are optimistic-concurrency-aware.** `putIfVersion` is the
 *    default for multi-writer correctness; `put` is convenience for "I
 *    know I'm the only writer" callers (single-server, tests).
 *
 * 4. **Reads return cursors, not unbounded arrays.** `list` takes
 *    `{ cursor?, limit? }` so large namespaces never OOM. Stages iterate
 *    as long as they need.
 *
 * 5. **Recognition is separate from recall.** `seen(signature)` is a
 *    boolean check — cheaper than `get` when the caller only needs
 *    "have we processed this before?" (cognitive-arch reviewer ask).
 *
 * 6. **Feedback flows back.** `feedback(id, usefulness)` lets retrieval
 *    stages signal "this entry was actually used / wasn't used" so
 *    adapters can drive their own learning / eviction (RAG-theory ask).
 */
import type { MemoryIdentity } from '../identity';
import type { MemoryEntry } from '../entry';

/** Pagination cursor — opaque string, adapter-specific encoding. */
export type MemoryCursor = string;

/** Options for listing entries in a namespace. */
export interface ListOptions {
  /** Continuation token from a previous `list` call. Omit for the first page. */
  readonly cursor?: MemoryCursor;
  /** Maximum entries to return in this page. Adapters may cap this lower. */
  readonly limit?: number;
  /** Optional filter — only return entries matching these tiers. */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;
}

/** Result of a paginated `list` call. */
export interface ListResult<T = unknown> {
  readonly entries: readonly MemoryEntry<T>[];
  /** Present iff more pages exist. Pass back into `list.cursor` to continue. */
  readonly cursor?: MemoryCursor;
}

/** Outcome of a `putIfVersion` attempt. */
export interface PutIfVersionResult {
  /** True iff the write succeeded. */
  readonly applied: boolean;
  /**
   * When `applied === false`, the current version stored — caller can
   * decide whether to retry, merge, or abort. Absent if the entry did
   * not exist at all.
   */
  readonly currentVersion?: number;
}

/**
 * Common surface for all backends. Every method takes `MemoryIdentity`
 * as the scoping argument; stores MUST prefix their internal keys with
 * `identityNamespace(identity)` to prevent cross-tenant access.
 */
export interface MemoryStore {
  /**
   * Fetch one entry by id within the given identity's namespace.
   * Returns `null` when the entry doesn't exist OR has expired (TTL).
   * Callers should not distinguish — both mean "no data."
   *
   * Side effect: adapters MAY increment `accessCount` and update
   * `lastAccessedAt` when returning the entry (decay signals).
   */
  get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null>;

  /**
   * Unconditional write — overwrites any existing entry with the same id.
   * Prefer `putIfVersion` in multi-writer scenarios.
   */
  put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void>;

  /**
   * Optimistic-concurrency write. Writes only if the stored version equals
   * `expectedVersion`, OR if no entry exists at all AND `expectedVersion`
   * is `0` (first-write sentinel).
   *
   * Returns `{ applied: true }` on success, `{ applied: false, currentVersion }`
   * when the caller's assumed version is stale.
   */
  putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
  ): Promise<PutIfVersionResult>;

  /**
   * Page through entries in the identity's namespace. Ordered by adapter's
   * choice (usually most-recently-updated first) — consumers that care
   * about order should filter client-side.
   */
  list<T = unknown>(identity: MemoryIdentity, options?: ListOptions): Promise<ListResult<T>>;

  /** Remove one entry. No-op if the entry doesn't exist. */
  delete(identity: MemoryIdentity, id: string): Promise<void>;

  /**
   * Cheap "have we processed this signature before?" check. Useful for
   * deduplication, idempotent writes, and cognitive-arch-style recognition
   * vs. recall. Signature is an opaque string the caller controls
   * (content hash, canonicalized fact, etc.).
   */
  seen(identity: MemoryIdentity, signature: string): Promise<boolean>;

  /**
   * Write-side of the recognition set — adds a signature so subsequent
   * `seen()` calls return `true`. Stages register signatures as entries
   * are written (content hashes, canonicalized facts). Separate from the
   * entry store: a signature outlives the entry that produced it, so
   * dedup survives garbage collection.
   */
  recordSignature(identity: MemoryIdentity, signature: string): Promise<void>;

  /**
   * Record usefulness feedback for an entry. `usefulness` in `[-1, 1]`:
   *   -1 = retrieved but harmful / misleading
   *    0 = retrieved but not used (neutral)
   *    1 = retrieved AND used in the final answer
   *
   * Non-finite values (NaN / ±Infinity) MUST be rejected by adapters —
   * they poison the aggregate. Caller should pass a finite number in
   * `[-1, 1]`; adapters clamp to the valid range for hardening.
   */
  feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void>;

  /**
   * Read-side of feedback — aggregated usefulness for an entry. Returns
   * `null` when no feedback has been recorded (distinct from "neutral
   * average of 0" — callers often want to treat the two differently).
   * Retrieval stages consume this to feedback-weight rankings.
   */
  getFeedback(
    identity: MemoryIdentity,
    id: string,
  ): Promise<{ average: number; count: number } | null>;

  /**
   * GDPR — remove ALL entries for the given identity.
   * Must be implementable in one operation per backend (DELETE WHERE prefix).
   */
  forget(identity: MemoryIdentity): Promise<void>;
}
