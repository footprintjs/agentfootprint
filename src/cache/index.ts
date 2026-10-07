/**
 * agentfootprint/cache — public surface for the cache layer.
 *
 * The strategy an agent runs is chosen by CAPABILITY: the provider adapter
 * declares how its wire caches (`LLMProvider.promptCaching`) and
 * `cacheStrategyFor(provider)` returns the one strategy that serves it —
 *   - `BreakpointCacheStrategy` — `mode: 'breakpoints'` (Anthropic's
 *     `cache_control`; `anthropic()`, `browserAnthropic()`);
 *   - `AutomaticCacheStrategy` — `mode: 'automatic'` (OpenAI and Azure
 *     OpenAI cache on their own);
 *   - `NoOpCacheStrategy` — nothing declared (Mock, Ollama, Bedrock Converse,
 *     Gemini, any adapter that has not said).
 * Nothing registers at module load and nothing is keyed by provider name, so
 * a decorator that renames its provider keeps caching by forwarding the
 * declaration.
 *
 * Public types (re-exported for consumers):
 *   - PromptCaching (the provider's declaration), CachePolicy, CacheMarker,
 *     CacheStrategy, CacheMetrics, CachePolicyContext, CacheStrategyContext,
 *     CacheUsage
 */

// Public types
export type {
  CachePolicy,
  CachePolicyContext,
  CacheMarker,
  CacheStrategy,
  CacheStrategyContext,
  CacheMetrics,
  CacheUsage,
  // What a provider adapter declares about its wire (`LLMProvider.promptCaching`).
  PromptCaching,
} from './types.js';

// The honesty primitive the meter is typed in (9.59.0). Re-exported
// reference-equal from `src/lib/claim/` — the SAME symbols
// `agentfootprint/maps` exports, so `known` from either door is one function.
export {
  known,
  unknown,
  notApplicable,
  isKnown,
  valueOr,
  describeClaim,
  type Claim,
} from '../lib/claim/claim.js';

// Strategy selection — by the provider's declared capability, never its name
export { cacheStrategyFor } from './cacheStrategyFor.js';

// Built-in strategy classes (for consumers who want explicit overrides via
// `Agent.create({ cacheStrategy })`)
export { NoOpCacheStrategy } from './strategies/NoOpCacheStrategy.js';
export { BreakpointCacheStrategy } from './strategies/BreakpointCacheStrategy.js';
export { AutomaticCacheStrategy } from './strategies/AutomaticCacheStrategy.js';

// Recorder
export { cacheRecorder } from './cacheRecorder.js';
export type {
  CacheRecorderOptions,
  CacheRecorderHandle,
  CacheReportSummary,
  PerIterEntry,
} from './cacheRecorder.js';
