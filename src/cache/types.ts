/**
 * Cache layer — public types.
 *
 * Three layers, each with one responsibility:
 *
 *   1. CONSUMER DSL — `CachePolicy` field on every injection factory.
 *      Declarative, like GraphQL schema input. Says WHAT should be
 *      cacheable. Examples: `cache: 'always'`, `cache: 'while-active'`.
 *
 *   2. AGNOSTIC MARKERS — `CacheMarker[]` produced by the
 *      `CacheDecision` subflow at runtime. Provider-independent
 *      identification of "cacheable prefix in field X up to index Y".
 *
 *   3. PROVIDER STRATEGY — one `CacheStrategy` implementation per
 *      provider (Anthropic / OpenAI / Bedrock / NoOp). Translates
 *      agnostic markers to provider-specific wire format AND extracts
 *      cache metrics from the provider's response.
 *
 * The interfaces are read-only / immutable by convention. Strategies
 * MUST be stateless across runs; per-run state lives in the
 * `CacheStrategyContext` passed into `prepareRequest`.
 */

import type { LLMRequest } from '../adapters/types.js';

// ─── Layer 1: Consumer DSL ────────────────────────────────────────

/**
 * `cache:` field shape on every injection factory.
 *
 * Defaults per factory (chosen so `cache:` is rarely written explicitly):
 * - `defineSteering` → `'always'`
 * - `defineFact` → `'always'`
 * - `defineSkill` → `'while-active'`
 * - `defineInstruction` → `'never'`
 * - `defineMemory` → `'while-active'`
 *
 * Variants:
 * - `'always'` — cache whenever this injection is in `activeInjections`.
 *   Sugar for `{ until: () => false }`. The most aggressive form.
 * - `'never'` — never cache. Use for volatile content (rule predicates,
 *   on-tool-return injections, content with timestamps or per-request IDs).
 *   Sugar for `{ until: () => true }` — i.e., always-invalidated.
 * - `'while-active'` — cache while this injection appears in
 *   `activeInjections[]` for the current iteration. The cache invalidates
 *   the moment the injection becomes inactive (predicate returns `false`,
 *   skill deactivates, fact gets removed). Skill default; intuitive
 *   meaning regardless of factory.
 * - `{ until: ctx => ... }` — conditional invalidation; cached UNTIL
 *   the predicate returns `true`. The predicate runs every iteration;
 *   if it flips to `true`, the cache prefix is rebuilt.
 *
 * **Composition**: the four sentinel forms cover most cases. For
 * complex composition (e.g., "cache always EXCEPT after iter 5"), use
 * the `{ until: ... }` form directly:
 *
 * ```ts
 * // Stable for the first 5 iters, then flush:
 * cache: { until: ctx => ctx.iteration > 5 }
 *
 * // Cache while iter > 1 (skip caching on the very first call):
 * cache: { until: ctx => ctx.iteration <= 1 }
 *
 * // Invalidate when cumulative spend exceeds budget:
 * cache: { until: ctx => ctx.cumulativeInputTokens > 50_000 }
 * ```
 *
 * The predicate is the DSL's escape hatch — Turing-complete by design.
 * 80% of consumers stick with the three sentinel strings; power users
 * compose freely via `{ until }`.
 */
export type CachePolicy =
  | 'always'
  | 'never'
  | 'while-active'
  | { readonly until: (ctx: CachePolicyContext) => boolean };

/**
 * Context passed to a `CachePolicy.until` predicate. Read-only
 * snapshot; predicates must be pure.
 *
 * Mirrors `InjectionContext` but trimmed to the fields a cache
 * predicate would meaningfully inspect.
 */
export interface CachePolicyContext {
  /** Current ReAct iteration (1-based). */
  readonly iteration: number;
  /** Number of iterations remaining (= maxIterations - iteration). */
  readonly iterationsRemaining: number;
  /** The current user message that started this turn. */
  readonly userMessage: string;
  /** Last tool that returned, if any. */
  readonly lastToolName?: string;
  /** Cumulative input tokens so far this run. */
  readonly cumulativeInputTokens: number;
}

// ─── Layer 2: Agnostic markers ────────────────────────────────────

/**
 * Provider-independent identification of a cacheable prefix.
 *
 * The CacheDecision subflow walks `activeInjections` and emits one
 * marker per slot whose entries from index 0..boundaryIndex form a
 * stable, contiguous, cacheable prefix.
 *
 * `field` is the request field this marker targets. Each provider
 * strategy translates it differently:
 * - `'system'` → Anthropic puts `cache_control` on a system block
 * - `'tools'` → Anthropic puts `cache_control` on a tools array entry
 * - `'messages'` → Anthropic puts `cache_control` on the LAST content
 *   block of the LAST message (Anthropic-specific positional rule)
 */
export interface CacheMarker {
  readonly field: 'system' | 'tools' | 'messages';
  /**
   * 0-based index of the LAST element in `field` to include in the
   * cached prefix. Everything from index 0..boundaryIndex (inclusive)
   * is cacheable.
   *
   * **Provider note for `field: 'messages'`**: Anthropic's `cache_control`
   * on `messages` is positional — it only takes effect on the LAST
   * content block of the LAST message in the cacheable prefix. The
   * AnthropicCacheStrategy translates `boundaryIndex` to the right
   * positional placement; consumers and CacheDecision subflow don't
   * see this complexity.
   */
  readonly boundaryIndex: number;
  /**
   * Suggested TTL for this marker. Strategies map to provider-specific
   * values (Anthropic: `'short'` → 5min ephemeral, `'long'` → 1h beta).
   */
  readonly ttl: 'short' | 'long';
  /**
   * Diagnostic string surfaced in cacheRecorder events. Helps consumers
   * understand WHY this marker fired. Examples: `'always-on injections'`,
   * `'skill body (port-error-triage)'`.
   */
  readonly reason: string;
}

// ─── Layer 3: Provider strategy ───────────────────────────────────

/**
 * Per-provider cache implementation. One strategy per provider name;
 * registered in a default map keyed by `LLMProvider.name`.
 *
 * Strategies MUST be stateless across runs. Any per-run state (handle
 * cache, hit-rate tracking) lives inside the strategy instance.
 */
export interface CacheStrategy {
  /** Provider name match. e.g. `'anthropic'`, `'openai'`, `'bedrock'`. */
  readonly providerName: string;
  /**
   * Static description of what this strategy can do. Read by the
   * CacheDecision subflow to know whether to bother emitting markers,
   * and how many to emit before clamping to provider limits.
   */
  readonly capabilities: CacheCapabilities;
  /**
   * Translate agnostic markers to provider-specific wire format.
   *
   * Async to support handle-based caching (Gemini does
   * `createCachedContent` and references handles; not in v2.6 but
   * the interface is async-ready for v2.7+).
   *
   * Returns the modified request AND the markers actually applied
   * (after capability-clamping). `markersApplied` flows into the
   * cacheRecorder for diagnostic surfacing.
   */
  prepareRequest(
    req: LLMRequest,
    candidates: readonly CacheMarker[],
    ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }>;
  /**
   * Extract cache hit/miss metrics from the provider's `usage` field.
   * Each provider names its cache fields differently:
   * - Anthropic: `cache_creation_input_tokens` + `cache_read_input_tokens`
   * - OpenAI: `prompt_tokens_details.cached_tokens`
   *
   * Returns `undefined` for providers without cache reporting (Mock, NoOp).
   */
  extractMetrics(usage: unknown): CacheMetrics | undefined;
}

/**
 * Static description of a strategy's capabilities. The CacheDecision
 * subflow reads this BEFORE calling `prepareRequest` so it can clamp
 * candidates to a count the strategy can actually use.
 */
export interface CacheCapabilities {
  /**
   * `true` if this strategy actually does anything. `false` for NoOp,
   * Mock, or providers we haven't built yet. CacheDecision subflow
   * skips entirely when `enabled` is `false`.
   */
  readonly enabled: boolean;
  /**
   * Maximum number of cache markers per request. Anthropic enforces 4
   * cache breakpoints per request; OpenAI is automatic (∞); Gemini
   * is per-handle (∞ effectively). Strategies clamp internally.
   */
  readonly maxMarkers: number;
  /**
   * TTL values this strategy can map to. Anthropic supports both;
   * OpenAI is fixed (~5min); some providers may only support one.
   */
  readonly ttls: ReadonlyArray<'short' | 'long'>;
  /**
   * Which request fields this strategy can mark. Most providers support
   * all three (system / tools / messages); some are field-restricted.
   */
  readonly fields: ReadonlyArray<'system' | 'tools' | 'messages'>;
  /**
   * `true` if the provider auto-caches without explicit markers (OpenAI).
   * In that case `prepareRequest` is a pass-through; only
   * `extractMetrics` does meaningful work. Surfaced for documentation
   * (so consumers know `cache: 'never'` may not actually disable caching
   * on auto-caching providers).
   */
  readonly automatic: boolean;
}

/**
 * Per-run state passed into `prepareRequest`. Strategies use this to
 * make per-iteration decisions (rate of cache invalidation, current
 * iteration index, etc.) without leaking state into module scope.
 */
export interface CacheStrategyContext {
  readonly iteration: number;
  readonly iterationsRemaining: number;
  /**
   * Hit rate across previous iterations of this run (0..1). Strategies
   * use this for self-disable behaviors (e.g., AnthropicCacheStrategy
   * auto-skips markers when hit rate < 30% to avoid the cache-write
   * penalty without recoup).
   */
  readonly recentHitRate: number | undefined;
  /**
   * `true` when `Agent.create({ caching: 'off' })` is set OR a
   * higher-level kill switch fires. Strategy MUST honor this and
   * return the request unchanged.
   */
  readonly cachingDisabled: boolean;
}

// ─── Metrics shape (returned by `extractMetrics`) ─────────────────

/**
 * Normalized cache metrics extracted from a provider's `usage`
 * response. cacheRecorder consumes these for hit-rate tracking,
 * cost estimation (via PricingTable), and diagnostic events.
 */
export interface CacheMetrics {
  /** Tokens served from cache (10% / 50% / 25% off depending on provider). */
  readonly cacheReadTokens: number;
  /** Tokens written to cache this call (premium varies by provider). */
  readonly cacheWriteTokens: number;
  /** New input tokens not from cache — full price. */
  readonly freshInputTokens: number;
}
