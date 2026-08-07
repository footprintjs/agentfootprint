/**
 * Memory subsystem — public type surface.
 *
 * THE 2D mental model the library teaches:
 *
 *     MEMORY = TYPE × STRATEGY × STORE
 *
 *     TYPE       — what shape of memory you're keeping
 *                  (Episodic messages / Semantic facts / Narrative beats /
 *                   Causal footprintjs snapshots)
 *     STRATEGY   — how to fit content into the next LLM call
 *                  (Window / Budget / Summarize / TopK / Extract / Decay / Hybrid)
 *     STORE      — where the bytes live
 *                  (InMemoryStore / Redis / Postgres / DynamoDB / Vector ...)
 *
 * Strategy is universal — same Window works for Episodic and for Causal.
 * That's why examples are organized by strategy (the discipline) not by
 * type (the shape).
 *
 * Pattern: Single-Source-of-Truth const objects + discriminated union.
 *          Mirrors `src/conventions.ts` (SUBFLOW_IDS, INJECTION_KEYS).
 *          NEVER enums (TS enums emit runtime objects + opacity).
 *          Const-as-const erases at compile time, accepts string literals,
 *          and gives consumers IDE autocomplete + refactor safety.
 *
 * Role:    Layer-1 contract for the memory subsystem. Step 2's
 *          `defineMemory()` factory consumes these to build pipelines;
 *          Step 4's `Agent.memory()` builder mounts the resulting
 *          definitions; Step 5's Causal machinery extends them.
 *
 * Emits:   Indirectly — every memory pipeline emits the unified
 *          `agentfootprint.context.injected` event with `source: 'memory'`
 *          when its read subflow places content into the system-prompt
 *          slot (every shipped formatter writes `role: 'system'`, and
 *          system-role recall composes into `inject.systemPrompt`).
 *
 * @see ./define.ts          for the `defineMemory()` factory itself
 * @see ../../docs-next      for guides + the 7 strategy examples
 * @see MEMORY.md            for the load-bearing design memory
 */

import type { LLMProvider } from '../adapters/types.js';
import type { Embedder } from './embedding/index.js';
import type { MemoryStore } from './store/index.js';
import type { MemoryIdentity } from './identity/index.js';
import type { RetrievalStrategy } from './retrieval/types.js';

// ─── Const-objects (SSOT) ───────────────────────────────────────────

/**
 * What shape of memory you're keeping.
 *
 * - `EPISODIC`  — raw conversation messages, replayed on next turn
 * - `SEMANTIC`  — extracted structured facts, deduped on key
 * - `NARRATIVE` — beats / summaries of prior runs (append-only)
 * - `CAUSAL`    — footprintjs execution snapshots, the differentiator
 *                 (replays stored decisions + tool evidence for "why?"
 *                 follow-ups — harvested automatically per run)
 */
export const MEMORY_TYPES = {
  EPISODIC: 'episodic',
  SEMANTIC: 'semantic',
  NARRATIVE: 'narrative',
  CAUSAL: 'causal',
} as const;
export type MemoryType = (typeof MEMORY_TYPES)[keyof typeof MEMORY_TYPES];

/**
 * How content is selected / compressed for the next LLM call.
 *
 * A `WINDOW` strategy on an Episodic store keeps the last N messages; on
 * Semantic / Narrative it keeps the last N facts / beats. NOT universal: the
 * `CAUSAL` type accepts ONLY `TOP_K` — its snapshots are matched semantically
 * against the new query, never by recency, so `buildCausalPipeline` throws on
 * any other strategy kind. Mix and match the non-Causal types.
 */
export const MEMORY_STRATEGIES = {
  WINDOW: 'window',
  BUDGET: 'budget',
  SUMMARIZE: 'summarize',
  TOP_K: 'topK',
  EXTRACT: 'extract',
  DECAY: 'decay',
  HYBRID: 'hybrid',
} as const;
export type MemoryStrategyKind = (typeof MEMORY_STRATEGIES)[keyof typeof MEMORY_STRATEGIES];

/**
 * When the memory's READ subflow runs.
 *
 * Default `TURN_START` reads memory once per `agent.run()`. Use
 * `EVERY_ITERATION` only when the strategy is sensitive to in-loop tool
 * results — every-iteration multiplies store-latency by iteration-count.
 */
export const MEMORY_TIMING = {
  EVERY_ITERATION: 'every-iteration',
  TURN_START: 'turn-start',
} as const;
export type MemoryTiming = (typeof MEMORY_TIMING)[keyof typeof MEMORY_TIMING];

/**
 * For Causal memory only — which slice of a footprintjs snapshot to
 * inject. Snapshots can run 100KB+; projecting prevents context blowup.
 *
 * - `DECISIONS` — `decide()`/`select()` evidence only (the "why" chain)
 * - `COMMITS`   — commitLog only (every state write, ordered)
 * - `NARRATIVE` — narrative entries only (human-readable trace)
 * - `FULL`      — entire snapshot (use sparingly)
 */
export const SNAPSHOT_PROJECTIONS = {
  DECISIONS: 'decisions',
  COMMITS: 'commits',
  NARRATIVE: 'narrative',
  FULL: 'full',
} as const;
export type SnapshotProjection = (typeof SNAPSHOT_PROJECTIONS)[keyof typeof SNAPSHOT_PROJECTIONS];

// ─── Strategy discriminated-union ───────────────────────────────────

/**
 * Window — keep the last `size` entries. Pure rule, no LLM, no embedder.
 *
 * NAMING (7.27.1): its siblings below are `BudgetStrategy`, `TopKStrategy`
 * and so on, unprefixed. This one carries the `Memory` prefix because
 * `WindowStrategy` is already taken, at the package root, by something else
 * entirely: the conversation-window seam (`{ name, plan(input) }`,
 * core/agent/window/strategy.ts, public since 7.17.0). Two exported types of
 * the same name and incompatible shapes, reachable from two entry points, is
 * a trap for anyone importing from the wrong one — so the memory config
 * record took the prefix. `agentfootprint/memory` still exports the old name
 * as a deprecated alias, so no import breaks.
 */
export interface MemoryWindowStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.WINDOW;
  readonly size: number;
}

/**
 * Budget — pick entries that fit within a token budget. Used as a
 * decider stage: skip-if-empty | skip-if-no-budget | pick-by-tokens.
 */
export interface BudgetStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.BUDGET;
  /** Reserve N tokens for prompt headers / new user message. Default 256. */
  readonly reserveTokens?: number;
  /** Skip injection below this token floor. Default 100. */
  readonly minimumTokens?: number;
  /** Hard cap on entries to inject — guards against "lost-in-the-middle". */
  readonly maxEntries?: number;
}

/**
 * Summarize — when the conversation grows long, an LLM compresses older
 * turns into a paragraph; recent N turns stay raw. The standard answer
 * to "long conversations blow context."
 */
export interface SummarizeStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.SUMMARIZE;
  /** Keep this many most-recent turns uncompressed. */
  readonly recent: number;
  /** LLM that does the compression — recommend a cheap model (haiku). */
  readonly llm: LLMProvider;
}

/**
 * Top-K — embed the user's query, retrieve top-K by cosine similarity.
 * STRICT threshold: when no entry meets the threshold, return EMPTY.
 * No fallback — garbage in context is worse than no memory.
 */
/**
 * Top-K retrieval, in either of its two spellings — and never both.
 *
 * The arms EXCLUDE (8.8.0). `{ topK, threshold }` is the shorthand;
 * `{ retrieval }` is the same rule written as a {@link RetrievalStrategy},
 * which is also how a different rule gets in. Accepting both would mean
 * one of two `k`s silently loses and the recording would name a `k` the
 * run did not use — so the type refuses it at the keystroke, and
 * `defineMemory` refuses it again at runtime for JavaScript callers.
 */
export type TopKStrategy = TopKShorthandStrategy | TopKRetrievalStrategy;

/** The historical spelling: two loose numbers. Unchanged since 2.x. */
export interface TopKShorthandStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.TOP_K;
  readonly topK: number;
  /** Min cosine similarity. Strict — no fallback below this. Default 0.7. */
  readonly threshold?: number;
  readonly embedder: Embedder;
  /**
   * Stable id of the embedder, filtered against `MemoryEntry.embeddingModel`
   * at search time so a later embedder swap cannot silently mix two vector
   * spaces. Pair it with the same value passed to `indexDocuments`.
   *
   * Wired in 8.8.0. `defineRAG` has accepted an `embedderId` since 7.x and
   * never forwarded it — an option the run did not read.
   */
  readonly embedderId?: string;
  /** See {@link TopKRetrievalStrategy.maxChars}. */
  readonly maxChars?: number;
  readonly retrieval?: never;
}

/** The spelled-out rule (8.8.0) — and the seam a re-ranker will arrive through. */
export interface TopKRetrievalStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.TOP_K;
  readonly embedder: Embedder;
  readonly retrieval: RetrievalStrategy;
  /** See {@link TopKShorthandStrategy.embedderId}. */
  readonly embedderId?: string;
  /**
   * A character budget for the admitted passages, spent in rank order
   * (8.19.0). Default none.
   *
   * It lives on BOTH arms, unlike `topK`/`threshold`, because it is not a
   * second spelling of the retrieval rule: the rule decides WHICH
   * candidates and how many, this bounds how much TEXT the winners are
   * allowed to be. A count bound is not a size bound, so the two compose
   * rather than exclude — `retrieval: topK({ k: 10 })` with
   * `maxChars: 3000` is a coherent request and is honoured as written.
   */
  readonly maxChars?: number;
  readonly topK?: never;
  readonly threshold?: never;
}

/**
 * Extract — on WRITE, an LLM (or pattern matcher) distills entries from
 * raw messages into structured shapes (facts/beats). Usually paired with
 * a load-side strategy like TopK or Window for the read direction.
 */
export interface ExtractStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.EXTRACT;
  /** Pattern-based (regex heuristics, free) or LLM-based (paid). */
  readonly extractor: 'pattern' | 'llm';
  /** Required when `extractor: 'llm'`. */
  readonly llm?: LLMProvider;
  /** Discard extractions below this confidence. Default 0.7. */
  readonly minConfidence?: number;
  /** Cap entries extracted per turn. Default 5. */
  readonly maxPerTurn?: number;
}

/**
 * Decay — score entries by `recency × accessCount`, drop below floor.
 * For long-running agents where unused memory should fade.
 */
export interface DecayStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.DECAY;
  /** Half-life in milliseconds for the recency component. */
  readonly halfLifeMs: number;
  /** Drop entries scoring below this. Default 0.1. */
  readonly minScore?: number;
}

/**
 * Hybrid — compose multiple strategies. Each sub-strategy runs as its
 * own selector branch; results are merged in the order listed.
 */
export interface HybridStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.HYBRID;
  readonly strategies: ReadonlyArray<Exclude<Strategy, HybridStrategy>>;
}

/** The full strategy union — discriminated by `kind`. */
export type Strategy =
  | MemoryWindowStrategy
  | BudgetStrategy
  | SummarizeStrategy
  | TopKStrategy
  | ExtractStrategy
  | DecayStrategy
  | HybridStrategy;

// ─── Redaction policy hook (reserved for a future release) ──────────────────────

/**
 * Reserved API surface for content redaction before memory writes.
 * Impl is deferred; the field exists now so adding redaction later
 * is non-breaking. Snapshot/episodic writes may carry PII — this is
 * the integration point.
 */
export interface MemoryRedactionPolicy {
  /** Patterns to mask in stored content. */
  readonly patterns?: readonly RegExp[];
  /** Replacement string. Default `'[REDACTED]'`. */
  readonly replacement?: string;
}

// ─── MemoryDefinition — what defineMemory() returns ─────────────────

/**
 * The opaque value `defineMemory()` returns. `Agent.memory()` consumes
 * one of these per memory the consumer registers; multiple definitions
 * layer cleanly via per-id scope keys (`memoryInjection_${id}`).
 *
 * Generic `T` is the payload shape stored — `Message` for episodic,
 * `Fact` for semantic, `NarrativeBeat` for narrative, `RunSnapshot` for
 * causal. The factory infers `T` from `type`.
 */
export interface MemoryDefinition<T = unknown> {
  /** Stable identifier. Becomes the scope-key suffix and the Lens label. */
  readonly id: string;

  /** Surfaces in narrative / Lens hover. */
  readonly description?: string;

  /** Which TYPE shape — gates legal STRATEGY combinations. */
  readonly type: MemoryType;

  /** Compiled read subflow (built by the factory from type × strategy). */
  readonly read: ReadonlyMemoryFlowChart<T>;

  /** Compiled write subflow. Optional — `EPHEMERAL`-style configs omit. */
  readonly write?: ReadonlyMemoryFlowChart<T>;

  /** When `read` runs. Default `TURN_START`. */
  readonly timing: MemoryTiming;

  // NOTE (7.20.0): there was an `asRole: ContextRole` field here. It was
  // set by the factory and read by nobody — recall is always injected as
  // system. A definition field that no run consults is a claim the
  // recording cannot back, so it is gone along with the option that fed
  // it. See `./asRoleRefusal.ts`.

  /** Reserved for a future release — patterns to redact before write. */
  readonly redact?: MemoryRedactionPolicy;

  /** Snapshot projection — only meaningful when `type === CAUSAL`. */
  readonly projection?: SnapshotProjection;

  /**
   * The namespace this memory reads and writes (8.8.0).
   *
   * Absent — the historical behaviour, and still the right one for
   * conversation memory — means "whatever identity the run was given",
   * so each conversation remembers its own turns.
   *
   * Present means "always this namespace, whoever is asking", which is
   * what a shared document corpus is: a corpus does not belong to a
   * conversation, and reading it under a per-run conversation id is why
   * `defineRAG`'s own documented example retrieved nothing at all before
   * 8.8.0. `defineRAG` defaults it to `{ conversationId: '_global' }`,
   * matching `indexDocuments`'s default so the two sides meet.
   */
  readonly corpus?: MemoryIdentity;

  /**
   * Which claim this memory's injected block makes (8.8.0). `'memory'`
   * is conversation recall; `'rag'` is corpus retrieval, and it is the
   * value that reaches the recording as `ContextInjectedPayload.source`.
   *
   * The event vocabulary has carried a `'rag'` source since 2.x and
   * nothing ever emitted it — a declared value no run can produce is a
   * gap in the contract, not a spare.
   */
  readonly flavor?: MemoryFlavor;
}

/** What an injected memory block is claiming to be. */
export type MemoryFlavor = 'memory' | 'rag';

/**
 * Opaque tag for the compiled flowchart the factory hands back.
 * The actual type is `FlowChart<MemoryState>` from footprintjs but we
 * keep it nominal here so consumers can't reach in. The phantom type
 * parameter is preserved so consumers can write `ReadonlyMemoryFlowChart<MyShape>`
 * for documentation, even though the brand erases the parameter at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type ReadonlyMemoryFlowChart<_T> = {
  readonly __brand: 'ReadonlyMemoryFlowChart';
};

// ─── DefineMemoryOptions — what consumers PASS to defineMemory() ────

/**
 * Common options for every memory type. Type-specific options layer on
 * top via discriminated `type` field in the next overload set (Step 2).
 */
export interface DefineMemoryOptionsBase {
  readonly id: string;
  readonly description?: string;
  readonly store: MemoryStore;
  readonly strategy: Strategy;
  readonly timing?: MemoryTiming;
  // NOTE (7.20.0): `asRole?: ContextRole` used to sit here. Removing it
  // is what makes TypeScript report the declaration at the keystroke;
  // `defineMemory` throws for JavaScript callers and casts. See
  // `./asRoleRefusal.ts` for why it is refused rather than honoured.
  readonly redact?: MemoryRedactionPolicy;

  /**
   * Read and write under THIS namespace instead of the run's identity
   * (8.8.0). See {@link MemoryDefinition.corpus}.
   */
  readonly corpus?: MemoryIdentity;

  /**
   * Build a read-only memory (8.8.0): no write subflow is compiled, so
   * nothing this memory sees is ever stored back.
   *
   * The reason it exists: a retrieval corpus and a conversation log are
   * two different things sharing one pipeline. Writing the conversation
   * into the corpus makes the user's own question the best-scoring
   * "document" in it. `defineRAG` sets this.
   */
  readonly readOnly?: boolean;

  /** Which claim the injected block makes. See {@link MemoryDefinition.flavor}. */
  readonly flavor?: MemoryFlavor;
}

export interface DefineEpisodicOptions extends DefineMemoryOptionsBase {
  readonly type: typeof MEMORY_TYPES.EPISODIC;
}

export interface DefineSemanticOptions extends DefineMemoryOptionsBase {
  readonly type: typeof MEMORY_TYPES.SEMANTIC;
}

export interface DefineNarrativeOptions extends DefineMemoryOptionsBase {
  readonly type: typeof MEMORY_TYPES.NARRATIVE;
}

export interface DefineCausalOptions extends DefineMemoryOptionsBase {
  readonly type: typeof MEMORY_TYPES.CAUSAL;
  /** Slice of the snapshot to inject. Default `DECISIONS`. */
  readonly projection?: SnapshotProjection;
}

/** Discriminated by `type`. The factory uses this to pick the pipeline. */
export type DefineMemoryOptions =
  | DefineEpisodicOptions
  | DefineSemanticOptions
  | DefineNarrativeOptions
  | DefineCausalOptions;

// ─── Type guards (consumers + recorders) ────────────────────────────

export function isMemoryType(value: string): value is MemoryType {
  return (Object.values(MEMORY_TYPES) as string[]).includes(value);
}

export function isMemoryStrategyKind(value: string): value is MemoryStrategyKind {
  return (Object.values(MEMORY_STRATEGIES) as string[]).includes(value);
}

export function isMemoryTiming(value: string): value is MemoryTiming {
  return (Object.values(MEMORY_TIMING) as string[]).includes(value);
}

export function isSnapshotProjection(value: string): value is SnapshotProjection {
  return (Object.values(SNAPSHOT_PROJECTIONS) as string[]).includes(value);
}

// ─── Per-id scope-key convention (multi-memory layering) ────────────

/**
 * Scope-key prefix used when mounting multiple `.memory()` definitions
 * on the same Agent. Each memory writes to `memoryInjection_${id}` so
 * registrations never collide. Formatter merges all keys with this
 * prefix in registration order.
 */
export const MEMORY_INJECTION_KEY_PREFIX = 'memoryInjection_' as const;

export function memoryInjectionKey(id: string): string {
  return `${MEMORY_INJECTION_KEY_PREFIX}${id}`;
}

export function isMemoryInjectionKey(key: string): boolean {
  return key.startsWith(MEMORY_INJECTION_KEY_PREFIX);
}

/**
 * Scope-key prefix for the retrieval record a memory lifts to the parent
 * scope (8.8.0), one key per memory id — the same layering rule as
 * `memoryInjection_`.
 *
 * This key is the reason a backward slice can now reach a passage. It is
 * ORDINARY root state, so `sliceForKey('finalContent')` walks the
 * system-prompt write, and the record naming every candidate id and score
 * is one hop away. Before 8.8.0 the scores existed only inside the memory
 * subflow, which the root commit log never sees.
 */
export const RETRIEVAL_EVIDENCE_KEY_PREFIX = 'retrievalEvidence_' as const;

export function retrievalEvidenceKey(id: string): string {
  return `${RETRIEVAL_EVIDENCE_KEY_PREFIX}${id}`;
}

export function isRetrievalEvidenceKey(key: string): boolean {
  return key.startsWith(RETRIEVAL_EVIDENCE_KEY_PREFIX);
}
