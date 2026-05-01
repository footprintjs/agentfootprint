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
 *   - AnthropicCacheStrategy ('anthropic', 'browser-anthropic')
 *
 * Future strategies (Phase 8+):
 *   - OpenAICacheStrategy
 *   - BedrockCacheStrategy
 *   - GeminiCacheStrategy (v2.7+, async handle-based)
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
} from './types.js';

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
export type { CacheRecorderOptions, CacheRecorderHandle } from './cacheRecorder.js';
