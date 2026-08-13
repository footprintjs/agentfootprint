/**
 * artifacts/types — the claim-check shapes and the five-verb port.
 *
 * A tool stores its result under a REFERENCE and hands the model a claim
 * ticket; the model routes tickets instead of hauling data. These are the
 * shapes that make that sentence true: the ref (an opaque minted string),
 * the metadata a consumer decides from (never the bytes), and the store
 * port every backend implements.
 *
 * ── The constitution this port inherits (from `MemoryStore`) ────────────────
 *   1. **Scope is always the first argument.** Every call takes an
 *      {@link ArtifactScope} — the same tenant/principal/conversation tuple
 *      memory scopes on — so stores enforce isolation at the boundary. A ref
 *      alone opens NOTHING; a wrong scope surfaces as "no data", never as a
 *      cross-tenant read.
 *   2. **`get` returns `null` for missing OR expired.** Deliberate ambiguity:
 *      "no data" is the only actionable fact, and distinguishing the two would
 *      let a caller reason about another scope's contents.
 *   3. **Reads return cursors, not unbounded arrays.** `list` pages.
 *   4. **Methods return Promises uniformly**, so sync adapters can become
 *      async ones without breaking a caller.
 *
 * ── Five verbs, no more ─────────────────────────────────────────────────────
 * `put · head · get · delete · list`. The moment this port grows `query()` or
 * `transform()` we are building a database — compute belongs to the code leg,
 * and that refusal is written here so a future round can be refused by
 * citation. No streaming members either: an in-memory adapter must never fake
 * a stream (streaming is a later, feature-detected addition — not Phase 1).
 *
 * `head` earns its place because it IS the render-by-ref decision: a consumer
 * picks what to do from `kind` and `bytes` without paying for the payload.
 */

import type { MemoryIdentity } from '../memory/identity/types.js';

/**
 * The isolation tuple every artifact call presents — the SAME tuple memory
 * scopes on (`{ tenant?, principal?, conversationId }`), under a name that
 * says what it does here. One type, not a structural twin: two spellings of
 * one scoping rule could disagree, and this one cannot.
 *
 * The framework composes it from the run's identity/session (an anonymous run
 * scopes to its own runId; a session-bound run to its sessionId; an
 * identity-carrying run to the caller's tenant/principal tuple). A tool never
 * supplies it — `ctx.artifacts` is already bound.
 */
export type ArtifactScope = MemoryIdentity;

/**
 * The ref the model speaks — an opaque MINTED string (`art_` + 22 random
 * chars, ~26 total). Never content-addressed: the digest is metadata, never
 * the key (content-as-key would collide two tenants' identical bytes into one
 * object and could never name two generations of "the current dataset").
 * The grammar has ONE owner: `naming.ts`.
 */
export type ArtifactRef = string;

/** Where an artifact came from — the join to the trace. Facts, never invented:
 *  absent fields mean the minting door genuinely did not have them. */
export interface ArtifactOrigin {
  readonly runId?: string;
  readonly toolCallId?: string;
}

/**
 * The claim ticket's description — what a consumer needs to DECIDE, never the
 * bytes. This is what `head` returns, what `list` rows are, and what every
 * `artifacts.*` event carries (events never carry payloads).
 */
export interface ArtifactMeta {
  readonly ref: ArtifactRef;
  /** Consumer vocabulary — what this IS to whoever redeems it:
   *  `'dataset/rows'`, `'chart/spec'`, `'report/csv'`. Declared by the
   *  producer, never inferred. */
  readonly kind: string;
  /** MIME type of the payload: `'application/json'`, `'text/csv'`, … */
  readonly mediaType: string;
  /** Payload size in bytes (UTF-8 for text/JSON, byteLength for binary). */
  readonly bytes: number;
  /** The human name: `"Q3 sales by region"`. */
  readonly label?: string;
  /** `sha-256:<hex>` — integrity + idempotent re-put detection, computed at
   *  `put` when asked. Metadata, NEVER the key. Verified on `get`; a mismatch
   *  is a teaching refusal, never silent corruption. */
  readonly digest?: string;
  /** Unix ms when this artifact stops resolving — STATED at mint (from the
   *  store's ttl or the caller's own value, whichever is sooner), so consumers
   *  can reason about expiry instead of discovering it. Absent = no expiry. */
  readonly expiresAt?: number;
  /** The join to the causal record. */
  readonly origin?: ArtifactOrigin;
  /**
   * Derivation FACTS — the refs this artifact was computed from. Validated at
   * mint: naming a parent that does not resolve in the same scope is a
   * refusal (a foreign key that cannot dangle at birth). Deliberately NOT a
   * lineage-graph engine: walking parents is the consumer's fold over
   * `head()`, and causation stays the trace's job.
   */
  readonly parentRefs?: readonly ArtifactRef[];
  /** Unix ms when the artifact was stored. */
  readonly createdAt: number;
}

/** What `put` takes — everything on {@link ArtifactMeta} the CALLER owns.
 *  `ref`, `bytes`, `digest` and `createdAt` are the store's to stamp. */
export interface PutArtifactInput {
  readonly kind: string;
  readonly mediaType: string;
  /**
   * The payload. Strings and `Uint8Array` are stored byte-for-byte; any other
   * value must be JSON-serializable (it is measured, digested and — in the
   * durable adapters — persisted via JSON). A value JSON cannot carry is
   * refused at `put` by name, never stored as an approximation.
   */
  readonly data: unknown;
  readonly label?: string;
  /** Ask for an integrity digest, computed by the store at put. */
  readonly digest?: 'sha-256';
  /** Caller-stated expiry (unix ms). The store's own ttl may only TIGHTEN it. */
  readonly expiresAt?: number;
  readonly origin?: ArtifactOrigin;
  readonly parentRefs?: readonly ArtifactRef[];
}

/** Why an artifact left the store without its owner asking. */
export type ArtifactSweepReason = 'ttl' | 'max-bytes' | 'max-count';

/** One swept artifact — the fact a retention pass leaves behind. */
export interface SweptArtifact {
  readonly ref: ArtifactRef;
  readonly reason: ArtifactSweepReason;
  readonly kind: string;
  readonly bytes: number;
}

/**
 * What `put` hands back: the ticket, plus everything retention swept to admit
 * it. Sweeps ride the RESULT (collect during traversal, never post-process) so
 * the capability layer can put each one on the record as it happens — a store
 * that evicted silently would be a store that lies by omission.
 */
export interface ArtifactPutResult {
  readonly meta: ArtifactMeta;
  readonly swept: readonly SweptArtifact[];
}

/** What `get` returns when the ref resolves: the ticket and the payload. */
export interface ArtifactRecord {
  readonly meta: ArtifactMeta;
  readonly data: unknown;
}

/** Options for `list` — the cursor convention `MemoryStore.list` set. */
export interface ArtifactListOptions {
  /** Continuation token from a previous page. Omit for the first page. */
  readonly cursor?: string;
  /** Maximum rows this page. Adapters may cap it lower. */
  readonly limit?: number;
}

/** One page of tickets. Bytes never ride a listing. */
export interface ArtifactListResult {
  readonly artifacts: readonly ArtifactMeta[];
  /** Present iff more pages exist. */
  readonly cursor?: string;
}

/**
 * The port — five verbs, scope first, vendor-neutral. Adapters are the vendor
 * layer (`inMemoryArtifacts`, `fileArtifacts`, `sqliteArtifacts`; S3/GCS are a
 * later phase behind the same five verbs).
 */
export interface ArtifactStore {
  /**
   * Store a payload; mint and return the ticket. Validates the input (a
   * malformed put is refused by name), validates `parentRefs` resolve in the
   * SAME scope, measures, optionally digests, stamps `expiresAt` from the
   * store's retention — and reports what retention swept to make room.
   */
  put(scope: ArtifactScope, input: PutArtifactInput): Promise<ArtifactPutResult>;

  /**
   * The ticket without the payload — the render-by-ref decision. `null` for
   * missing-or-expired (the deliberate ambiguity; both mean "no data").
   */
  head(scope: ArtifactScope, ref: ArtifactRef): Promise<ArtifactMeta | null>;

  /**
   * The ticket and the payload. `null` for missing-or-expired. When the meta
   * carries a `digest`, the payload is re-verified here — a mismatch throws
   * {@link ArtifactIntegrityError}, never returns corrupt bytes as if whole.
   */
  get(scope: ArtifactScope, ref: ArtifactRef): Promise<ArtifactRecord | null>;

  /** Remove one artifact. No-op when it does not exist — deleting an absence
   *  is not an error, it is agreement. */
  delete(scope: ArtifactScope, ref: ArtifactRef): Promise<void>;

  /** Page through this scope's tickets, newest first. */
  list(scope: ArtifactScope, options?: ArtifactListOptions): Promise<ArtifactListResult>;
}

// ─── Refusals ────────────────────────────────────────────────────────

/**
 * A `put` named a parent that does not resolve in the same scope — a foreign
 * key that would dangle at birth. Refused at mint, because a derivation fact
 * that points at nothing is worse than no fact: every later consumer would
 * inherit the lie.
 */
export class UnknownParentRefError extends Error {
  readonly code = 'ERR_UNKNOWN_PARENT_REF' as const;
  /** The parents that failed to resolve. */
  readonly unresolved: readonly ArtifactRef[];

  constructor(unresolved: readonly ArtifactRef[]) {
    super(
      `[artifacts] put refused: parentRefs ${unresolved.map((r) => `'${r}'`).join(', ')} ` +
        `do not resolve in this scope. parentRefs are derivation FACTS validated at mint — ` +
        `a parent must exist (and not be expired) in the same scope when the child is born. ` +
        `Store the parent first, or drop it from parentRefs; head(ref) tells you what resolves.`,
    );
    this.name = 'UnknownParentRefError';
    this.unresolved = unresolved;
  }
}

/**
 * A stored payload no longer matches the digest minted with it. Thrown by
 * `get` instead of returning the bytes — corrupt data delivered as whole data
 * is the accepted-and-silently-wrong failure, and the one thing a claim check
 * must never do is honor a ticket with someone else's parcel.
 */
export class ArtifactIntegrityError extends Error {
  readonly code = 'ERR_ARTIFACT_INTEGRITY' as const;
  readonly ref: ArtifactRef;
  /** The digest minted at put. */
  readonly expected: string;
  /** The digest of what the store actually holds now. */
  readonly actual: string;

  constructor(ref: ArtifactRef, expected: string, actual: string) {
    super(
      `[artifacts] get('${ref}') refused: the stored payload no longer matches its minted ` +
        `digest (expected ${expected}, computed ${actual}). The bytes changed after put — ` +
        `a corrupted file, an external edit, or a store bug — and returning them as if whole ` +
        `would be silent corruption. Re-create the artifact from its source; the meta ` +
        `(head) is still readable.`,
    );
    this.name = 'ArtifactIntegrityError';
    this.ref = ref;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * A `put` this store cannot honor as stated — a payload JSON cannot carry, a
 * blank `kind`, a payload larger than the whole scope budget. Refused by name
 * at the door: storing an approximation would be accepted-and-silently-wrong.
 */
export class InvalidArtifactError extends Error {
  readonly code = 'ERR_INVALID_ARTIFACT' as const;

  constructor(detail: string) {
    super(`[artifacts] put refused: ${detail}`);
    this.name = 'InvalidArtifactError';
  }
}
