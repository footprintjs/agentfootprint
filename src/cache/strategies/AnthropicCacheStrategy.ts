/**
 * AnthropicCacheStrategy — translates agnostic CacheMarker[] to
 * Anthropic API's `cache_control: { type: 'ephemeral' }` markers.
 *
 * Anthropic-specific behaviors honored:
 *   - **4-marker limit**: Anthropic allows ≤4 cache breakpoints per
 *     request. Strategy clamps oversize candidate sets, keeping the
 *     first 4 in slot order.
 *   - **TTL mapping**: 'short' → default 5min ephemeral; 'long' →
 *     `ttl: '1h'` (1-hour beta).
 *   - **Provider-side hashing**: this strategy doesn't hash — Anthropic
 *     keys cache by exact byte prefix server-side. We don't need
 *     content hashes for the v2.6 surface; reserved for v2.7+ if a
 *     pre-flight cache-warm-check API ships.
 *
 * What this strategy DOES vs DOESN'T do:
 *   - DOES: clamp markers, attach to LLMRequest.cacheMarkers,
 *     extract metrics from response.usage
 *   - DOES NOT: rewrite the wire body. The provider
 *     (BrowserAnthropicProvider) reads `cacheMarkers` and applies
 *     `cache_control` blocks during body construction. Separation of
 *     concerns: strategy decides WHAT to cache; provider knows HOW
 *     to encode on its specific wire.
 *
 * Auto-registers in the strategy registry on module import for
 * provider names: 'anthropic', 'browser-anthropic'.
 */

import type {
  CacheCapabilities,
  CacheMarker,
  CacheMetrics,
  CacheStrategy,
  CacheStrategyContext,
} from '../types.js';
import type { LLMRequest } from '../../adapters/types.js';
import { registerCacheStrategy } from '../strategyRegistry.js';

/** Anthropic enforces 4 cache breakpoints per request. */
const ANTHROPIC_MAX_MARKERS = 4;

const ANTHROPIC_CAPABILITIES: CacheCapabilities = Object.freeze({
  enabled: true,
  maxMarkers: ANTHROPIC_MAX_MARKERS,
  ttls: ['short', 'long'] as readonly ('short' | 'long')[],
  fields: ['system', 'tools', 'messages'] as readonly (
    | 'system'
    | 'tools'
    | 'messages'
  )[],
  automatic: false,
});

export class AnthropicCacheStrategy implements CacheStrategy {
  readonly providerName = 'anthropic';
  readonly capabilities = ANTHROPIC_CAPABILITIES;

  async prepareRequest(
    req: LLMRequest,
    candidates: readonly CacheMarker[],
    ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }> {
    // Honor the agent-side kill switch even if reached this far —
    // belt-and-suspenders. CacheGate should have routed to no-markers
    // already, leaving `candidates` empty, but if a buggy gate lets
    // markers through with cachingDisabled=true, we still respect it.
    if (ctx.cachingDisabled) {
      return { request: req, markersApplied: [] };
    }

    if (candidates.length === 0) {
      return { request: req, markersApplied: [] };
    }

    // Clamp to Anthropic's 4-marker limit. Keep the first N in
    // slot order so we cover the most-stable prefixes (system /
    // always-on injections / tools) before less-stable trailing ones.
    const markersApplied =
      candidates.length <= ANTHROPIC_MAX_MARKERS
        ? candidates
        : candidates.slice(0, ANTHROPIC_MAX_MARKERS);

    const request: LLMRequest = {
      ...req,
      cacheMarkers: markersApplied,
    };
    return { request, markersApplied };
  }

  extractMetrics(usage: unknown): CacheMetrics | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const fresh = u.input_tokens ?? 0;
    // If neither cache field present, response didn't involve caching.
    // Returning undefined signals "no cache info" so cacheRecorder
    // doesn't compute a misleading 0% hit rate.
    if (cacheRead === 0 && cacheWrite === 0) return undefined;
    return {
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      freshInputTokens: fresh,
    };
  }
}

// Auto-register on module import. Both 'anthropic' (server-side) and
// 'browser-anthropic' (browser fetch) providers map to this strategy.
{
  const strategy = new AnthropicCacheStrategy();
  registerCacheStrategy(strategy);
  // Register the browser variant by cloning with the matching provider name.
  // Same behavior, different provider.name match-key.
  const browserStrategy: CacheStrategy = {
    providerName: 'browser-anthropic',
    capabilities: strategy.capabilities,
    prepareRequest: strategy.prepareRequest.bind(strategy),
    extractMetrics: strategy.extractMetrics.bind(strategy),
  };
  registerCacheStrategy(browserStrategy);
}
