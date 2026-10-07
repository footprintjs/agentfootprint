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
 *   3. STRATEGY — one `CacheStrategy` per CAPABILITY, chosen from what the
 *      provider DECLARES (`LLMProvider.promptCaching`), never from its name:
 *      explicit breakpoints, automatic prefix caching, or none. Decides
 *      which markers reach the request AND reads cache metrics off the
 *      port usage. The adapter owns the wire format.
 *
 * The interfaces are read-only / immutable by convention. Strategies
 * MUST be stateless across runs; per-run state lives in the
 * `CacheStrategyContext` passed into `prepareRequest`.
 */

import type { LLMRequest, LLMResponse } from '../adapters/types.js';
import type { Claim } from '../lib/claim/claim.js';

/**
 * The usage a strategy is actually handed — the PORT shape, exactly as it
 * rides `agentfootprint.stream.llm_end`.
 *
 * Named here rather than inlined because it is the load-bearing half of the
 * 9.59.0 meter fix: the interface below used to take `unknown`, so three
 * strategies parsed RAW WIRE names (`cache_read_input_tokens`,
 * `prompt_tokens_details`) off a value that has never carried them, every
 * field read `undefined`, and the meter recorded nothing while reporting a
 * 0% hit rate. Adapters normalise the wire ONCE, at the adapter ring
 * (`readCacheUsage`); a strategy reads the normalised result.
 *
 * The absence of `cacheRead` / `cacheWrite` is INFORMATION, not zero: the
 * adapter sets them only when the provider reported a number, so
 * absent = nobody measured, present-and-0 = measured zero.
 */
export type CacheUsage = LLMResponse['usage'];

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
 * stable, contiguous, cacheable prefix — and one more on the conversation
 * tail when everything before it is cacheable (the moving breakpoint).
 *
 * `field` is the request field this marker targets. An adapter that declares
 * `promptCaching.mode: 'breakpoints'` encodes it on its wire; the Anthropic
 * one does:
 * - `'system'` → `cache_control` on a system block
 * - `'tools'` → `cache_control` on a tools array entry
 * - `'messages'` → `cache_control` on the LAST content block of the
 *   message the index names (Anthropic's positional rule)
 */
export interface CacheMarker {
  readonly field: 'system' | 'tools' | 'messages';
  /**
   * 0-based index of the LAST element in `field` to include in the
   * cached prefix. Everything from index 0..boundaryIndex (inclusive)
   * is cacheable.
   *
   * **Provider note for `field: 'messages'`**: the index is a position in
   * `LLMRequest.messages`. Anthropic's `cache_control` on `messages` is
   * positional — it takes effect on the LAST content block of a message —
   * and the adapter translates the index into its own (coalesced) message
   * array; consumers and the CacheDecision subflow don't see this.
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

// ─── Layer 3: Strategy ────────────────────────────────────────────

/**
 * The cache strategy an agent runs between request assembly and the provider.
 *
 * Chosen by CAPABILITY: `cacheStrategyFor(provider)` reads the provider's
 * declared `promptCaching` and returns `BreakpointCacheStrategy`,
 * `AutomaticCacheStrategy` or `NoOpCacheStrategy`. Pass your own as
 * `Agent.create({ cacheStrategy })` to override it.
 *
 * Strategies MUST be stateless across runs; per-run state arrives in the
 * {@link CacheStrategyContext}.
 */
export interface CacheStrategy {
  /**
   * What the run's receipt records as the strategy that stood between
   * assembly and the port (`Receipt.cache.strategy`). The built-ins name the
   * capability they serve: `'breakpoints'`, `'automatic'`, `'none'`.
   */
  readonly name: string;
  /**
   * Decide which agnostic markers reach the request.
   *
   * Async to support handle-based caching (Gemini's `createCachedContent`
   * references handles) without another interface change.
   *
   * Returns the request (with `cacheMarkers` set for the adapter to encode)
   * AND the markers actually applied, after clamping. `markersApplied` flows
   * into the receipt and the cacheRecorder.
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
   * Read cache hit/miss metrics off the PORT usage the framework hands you
   * ({@link CacheUsage}) — never off a raw provider payload. The adapter has
   * already normalised the wire (Anthropic's `cache_read_input_tokens`,
   * OpenAI's `prompt_tokens_details.cached_tokens`, …) onto
   * `cacheRead` / `cacheWrite`.
   *
   * Returns a {@link Claim}, not `CacheMetrics | undefined`, because the
   * three answers are genuinely different and the meter must never blur
   * them:
   * - `known(metrics, …)`   — the provider reported cache token counts.
   * - `unknown(reason, …)`  — nothing measured this call (no usage payload,
   *                           or the provider reported no cache fields). The
   *                           report renders this as *unmeasured*, never 0.
   * - `notApplicable(…)`    — this provider cannot report cache usage at
   *                           all (it declares no `promptCaching`, or
   *                           declares `reportsUsage: false`).
   */
  extractMetrics(usage: CacheUsage | undefined): Claim<CacheMetrics>;
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
   * Hit rate across previous iterations of this run (0..1), when something
   * supplied one. Nothing in the library writes it today, so it arrives
   * `undefined`; the CacheGate's hit-rate rule reads the same value.
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
