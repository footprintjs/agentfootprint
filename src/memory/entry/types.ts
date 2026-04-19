import type { MemoryIdentity } from '../identity';

/**
 * MemoryEntry — a single stored item with decay-, version-, and source-aware
 * metadata.
 *
 * Entry shape is generic over `T` so stores can hold messages, facts,
 * narrative traces, or anything else JSON-serializable. The metadata fields
 * around `value` are what make entries first-class objects instead of raw
 * blobs:
 *
 *   - `version`       — optimistic concurrency (`putIfVersion`) + migration
 *   - `tier`          — MemGPT-style hot/warm/cold classification
 *   - `source`        — provenance — "where did this memory come from?"
 *   - `lastAccessedAt` / `accessCount` — decay signals
 *   - `ttl`           — absolute expiry at the storage layer
 *   - `embeddingModel`— compatibility check for semantic search
 *
 * Entries are **immutable in spirit** — a "mutation" is a new entry with the
 * same `id` and an incremented `version`. Storage adapters may implement
 * this as an in-place update or an append-only log, but the library treats
 * entries as values.
 *
 * NOTE: `readonly` modifiers are a TypeScript compile-time hint only. At
 * runtime, nothing prevents a consumer from mutating an entry they received.
 * The library's internal code never mutates entries; adapters that wish to
 * enforce this at runtime may `Object.freeze(entry)` before returning.
 */
export interface MemoryEntry<T = unknown> {
  /** Stable id within the identity namespace. */
  readonly id: string;

  /** The actual stored payload. JSON-serializable. */
  readonly value: T;

  /**
   * Free-form metadata — tags, labels, user-supplied annotations. Kept
   * separate from the decay / version fields so those stay typed.
   */
  readonly metadata?: Record<string, unknown>;

  /**
   * Monotonic version number. Stores use this for `putIfVersion` optimistic
   * concurrency — write only if the entry is still at the version the
   * writer expected. Defaults to 1 on first write; callers increment.
   */
  readonly version: number;

  /** Unix ms. */
  readonly createdAt: number;
  /** Unix ms. Equal to createdAt on first write. */
  readonly updatedAt: number;
  /** Unix ms. Updated by `store.get` / retrieval stages. Decay input. */
  readonly lastAccessedAt: number;
  /** Number of times this entry has been read. Decay input. */
  readonly accessCount: number;

  /**
   * Optional absolute expiry (unix ms). Storage adapters MUST refuse to
   * return entries past their ttl. Implementations: InMemory filters on
   * read, Redis uses native EXPIRE, DynamoDB uses TTL attribute.
   */
  readonly ttl?: number;

  /**
   * Optional decay policy applied at retrieval time. When present, stages
   * that rank entries (picker, reranker) decrease relevance for entries
   * whose `lastAccessedAt` is far in the past. See `decay.ts`.
   */
  readonly decayPolicy?: DecayPolicy;

  /**
   * Tier classification — enables MemGPT-style page-in/page-out policies.
   * Stages can filter by tier (e.g. "load hot entries first, consult cold
   * only under pressure"). Omitting the field means "untiered."
   */
  readonly tier?: 'hot' | 'warm' | 'cold';

  /**
   * Provenance — which turn / runtime stage / message produced this entry.
   * Lets retrieval cite sources ("remembered from turn 5") and lets
   * `causalChain` cross session boundaries.
   */
  readonly source?: MemorySource;

  /**
   * When the entry's `value` is an embedding, the model that produced it.
   * Vector search stages verify this matches the current embedder before
   * trusting distance scores — prevents silent retrieval corruption when a
   * model is swapped.
   */
  readonly embeddingModel?: string;
}

/**
 * Where a memory entry came from. The library populates this automatically
 * when entries are written from inside a memory stage (writeMessages,
 * extractFacts, etc.); consumers can populate it when writing programmatically.
 *
 * When searching across sessions ("did we learn this in a previous session?"),
 * `identity` + `turn` + `runtimeStageId` form a globally-unique causal coordinate
 * — you can replay exactly what the agent was doing when the entry was born.
 */
export interface MemorySource {
  /** Run-local turn counter. */
  readonly turn?: number;
  /** footprintjs runtime stage id (`stageId#executionIndex`). */
  readonly runtimeStageId?: string;
  /** Originating message id, if the entry came from a conversation turn. */
  readonly messageId?: string;
  /**
   * Cross-session provenance — the `MemoryIdentity` that produced this entry.
   * Lets retrieval stages show "remembered from session X, user Y, turn 5"
   * instead of anonymous citation. Storage adapters MUST preserve this field
   * verbatim on every read/write.
   */
  readonly identity?: MemoryIdentity;
}

/**
 * Natural-forgetting policy. Decay applies at retrieval time: the entry's
 * stored value is never mutated; only its computed "relevance" is adjusted.
 *
 * Consumers choose half-life + access boost to match their domain:
 *   - Fast-moving (news, tickets) — halfLifeMs ≈ 1 day, accessBoost ≈ 1.5
 *   - Stable (user profile, facts)— halfLifeMs ≈ 30 days, accessBoost ≈ 1.1
 */
export interface DecayPolicy {
  /**
   * How long for relevance to halve when never accessed. Milliseconds.
   */
  readonly halfLifeMs: number;

  /**
   * Multiplier applied per access (clamped to a reasonable ceiling inside
   * `applyDecay`). Values > 1.0 boost frequently-used entries; values in
   * (0, 1.0) would *reduce* relevance with use (rarely desired).
   */
  readonly accessBoost: number;
}
