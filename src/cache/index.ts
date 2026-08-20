/**
 * agentfootprint/cache — public surface for the cache layer (v2.6+).
 *
 * Importing this module side-effect-registers every built-in cache
 * strategy in the registry. The agentfootprint main barrel imports
 * from here so consumers get the registered strategies without
 * needing to know they exist.
 *
 * Strategies registered as of v2.6:
 *   - NoOp (wildcard '*' fallback) — always available, registered by
 *     the registry module itself
 *   - AnthropicCacheStrategy ('anthropic', 'browser-anthropic') — the one
 *     end-to-end strategy: the adapter sends markers AND reads cache usage
 *   - OpenAICacheStrategy ('openai', 'browser-openai') — pass-through
 *     (OpenAI auto-caches); reports `not-applicable` metrics until the
 *     adapter lifts `prompt_tokens_details.cached_tokens` onto the port
 *   - BedrockCacheStrategy ('bedrock') — `enabled: false`; the Bedrock
 *     adapter implements neither half of the cache contract
 *
 * Future strategies:
 *   - GeminiCacheStrategy (async handle-based)
 *
 * Public types (re-exported for consumers):
 *   - CachePolicy, CacheMarker, CacheStrategy, CacheCapabilities,
 *     CacheMetrics, CachePolicyContext, CacheStrategyContext
 */

// Side-effect imports — register strategies on module load.
import './strategies/AnthropicCacheStrategy.js';
import './strategies/OpenAICacheStrategy.js';
import './strategies/BedrockCacheStrategy.js';

// Public types
export type {
  CachePolicy,
  CachePolicyContext,
  CacheMarker,
  CacheStrategy,
  CacheStrategyContext,
  CacheCapabilities,
  CacheMetrics,
  CacheUsage,
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

// Strategy registry
export {
  getDefaultCacheStrategy,
  registerCacheStrategy,
  listRegisteredStrategies,
} from './strategyRegistry.js';

// Built-in strategy classes (for consumers who want explicit overrides)
export { NoOpCacheStrategy } from './strategies/NoOpCacheStrategy.js';
export { AnthropicCacheStrategy } from './strategies/AnthropicCacheStrategy.js';
export { OpenAICacheStrategy } from './strategies/OpenAICacheStrategy.js';
export { BedrockCacheStrategy } from './strategies/BedrockCacheStrategy.js';

// Recorder
export { cacheRecorder } from './cacheRecorder.js';
export type {
  CacheRecorderOptions,
  CacheRecorderHandle,
  CacheReportSummary,
  PerIterEntry,
} from './cacheRecorder.js';
