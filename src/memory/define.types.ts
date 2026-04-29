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
 *          when its read subflow places content into the messages slot.
 *
 * @see ./define.ts          for the `defineMemory()` factory itself
 * @see ../../docs-site      for guides + the 7 strategy examples
 * @see MEMORY.md            for the load-bearing design memory
 */

import type { LLMProvider } from '../adapters/types.js';
import type { ContextRole } from '../events/types.js';
import type { Embedder } from './embedding/index.js';
import type { MemoryStore } from './store/index.js';

// ─── Const-objects (SSOT) ───────────────────────────────────────────

/**
 * What shape of memory you're keeping.
 *
 * - `EPISODIC`  — raw conversation messages, replayed on next turn
 * - `SEMANTIC`  — extracted structured facts, deduped on key
 * - `NARRATIVE` — beats / summaries of prior runs (append-only)
 * - `CAUSAL`    — footprintjs execution snapshots, the differentiator
 *                 (zero-hallucination follow-ups via decision-evidence replay)
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
 * Universal across types. A `WINDOW` strategy on an Episodic store keeps
 * the last N messages; on a Causal store it keeps the last N snapshots.
 * Mix and match.
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

/** Window — keep the last `size` entries. Pure rule, no LLM, no embedder. */
export interface WindowStrategy {
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
export interface TopKStrategy {
  readonly kind: typeof MEMORY_STRATEGIES.TOP_K;
  readonly topK: number;
  /** Min cosine similarity. Strict — no fallback below this. Default 0.7. */
  readonly threshold?: number;
  readonly embedder: Embedder;
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
  | WindowStrategy
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

  /** Role to use when injecting formatted content into the messages slot. */
  readonly asRole: ContextRole;

  /** Reserved for a future release — patterns to redact before write. */
  readonly redact?: MemoryRedactionPolicy;

  /** Snapshot projection — only meaningful when `type === CAUSAL`. */
  readonly projection?: SnapshotProjection;
}

/**
 * Opaque tag for the compiled flowchart the factory hands back.
 * The actual type is `FlowChart<MemoryState>` from footprintjs but we
 * keep it nominal here so consumers can't reach in.
 */
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
  readonly asRole?: ContextRole;
  readonly redact?: MemoryRedactionPolicy;
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
