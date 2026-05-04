/**
 * Strategy registry — maps provider name → CacheStrategy.
 *
 * Auto-resolution at agent build time: agentfootprint inspects
 * `provider.name` and looks up the registered strategy for that
 * name. Falls back to `NoOpCacheStrategy` (registered under wildcard
 * `'*'`) when the provider isn't recognized.
 *
 * Phases shipping registered strategies:
 *   - v2.6 Phase 6 (this phase): NoOp
 *   - v2.6 Phase 7: AnthropicCacheStrategy ('anthropic',
 *     'browser-anthropic')
 *   - v2.6 Phase 8: OpenAICacheStrategy ('openai', 'browser-openai'),
 *     BedrockCacheStrategy ('bedrock')
 *   - v2.7+ : GeminiCacheStrategy (handle-based, async, deferred)
 *
 * Consumers can register their own strategy via
 * `registerCacheStrategy(strategy)`. Useful for in-house LLM proxies
 * or test mocks.
 */

import type { CacheStrategy } from './types.js';
import { NoOpCacheStrategy } from './strategies/NoOpCacheStrategy.js';

/**
 * Registry singleton. Populated by individual strategy modules
 * importing this and calling `registerCacheStrategy` at module load
 * time, OR by the consumer at agent build time.
 *
 * Contains the wildcard `'*'` → NoOp entry by default; never empty.
 */
const REGISTRY = new Map<string, CacheStrategy>([['*', new NoOpCacheStrategy()]]);

/**
 * Look up a CacheStrategy by provider name. Falls back to the
 * wildcard NoOp strategy if no match.
 *
 * Lookup is case-insensitive on the provider name.
 */
export function getDefaultCacheStrategy(providerName: string): CacheStrategy {
  const exact = REGISTRY.get(providerName);
  if (exact !== undefined) return exact;
  const lower = providerName.toLowerCase();
  if (lower !== providerName) {
    const lowercased = REGISTRY.get(lower);
    if (lowercased !== undefined) return lowercased;
  }
  // Fallback wildcard always present (set at module load by registerDefaults).
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return REGISTRY.get('*')!;
}

/**
 * Register (or replace) a strategy for a provider name. Called by
 * strategy modules (v2.6 Phase 7+) at module load OR by consumers
 * needing a custom backend. Replacing an existing strategy is allowed
 * — the most-recent registration wins.
 */
export function registerCacheStrategy(strategy: CacheStrategy): void {
  REGISTRY.set(strategy.providerName, strategy);
}

/**
 * Read-only view of registered strategy names. Useful for diagnostics
 * (e.g., logging "we have strategies for: anthropic, openai, *").
 */
export function listRegisteredStrategies(): readonly string[] {
  return [...REGISTRY.keys()];
}

/**
 * Internal helper for tests: reset the registry to the default
 * (wildcard → NoOp only). Not exported from the public barrel.
 */
export function _resetRegistryForTests(): void {
  REGISTRY.clear();
  REGISTRY.set('*', new NoOpCacheStrategy());
}
