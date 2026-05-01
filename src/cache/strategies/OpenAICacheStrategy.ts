/**
 * OpenAICacheStrategy — metrics-only strategy for OpenAI providers.
 *
 * OpenAI auto-caches request prefixes ≥1024 tokens at 50% off.
 * No client-side opt-in markers needed (and no way to influence
 * cache behavior from the client). The strategy:
 *
 *   - **prepareRequest**: pass-through. We can't tell OpenAI what
 *     to cache; they decide automatically. Markers are silently
 *     dropped (the 80% case for OpenAI consumers is "I declared
 *     cache: 'always' for my injections" — that's still meaningful
 *     because (a) it's portable across providers, (b) for OpenAI
 *     the auto-cache may still hit on stable prefixes regardless).
 *   - **extractMetrics**: reads `prompt_tokens_details.cached_tokens`
 *     from OpenAI's usage response so cacheRecorder can surface
 *     hit rates / dollar savings.
 *
 * Auto-registers on module import for: 'openai', 'browser-openai'.
 *
 * Documentation note for consumers (Phase 12 docs): the `cache:`
 * directive on injection definitions is portable but has NO LOCAL
 * EFFECT on OpenAI runs — the provider auto-caches based on prefix
 * length. The directive still ships correctly with the agent and
 * lights up automatically when you swap to Anthropic / Bedrock.
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

const OPENAI_CAPABILITIES: CacheCapabilities = Object.freeze({
  // `enabled: true` because metrics ARE extracted (cacheRecorder shows
  // hit rates). The `automatic: true` flag tells consumers the markers
  // are inert here — OpenAI decides what to cache, not us.
  enabled: true,
  maxMarkers: 0,
  ttls: ['short'] as readonly ('short' | 'long')[],
  fields: [] as readonly ('system' | 'tools' | 'messages')[],
  automatic: true,
});

export class OpenAICacheStrategy implements CacheStrategy {
  readonly providerName = 'openai';
  readonly capabilities = OPENAI_CAPABILITIES;

  async prepareRequest(
    req: LLMRequest,
    _candidates: readonly CacheMarker[],
    _ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }> {
    // Pass-through. OpenAI auto-caches; no opt-in needed.
    return { request: req, markersApplied: [] };
  }

  extractMetrics(usage: unknown): CacheMetrics | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as {
      prompt_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    if (cached === 0) return undefined;
    const totalPrompt = u.prompt_tokens ?? cached;
    return {
      cacheReadTokens: cached,
      cacheWriteTokens: 0, // OpenAI doesn't charge a write premium
      freshInputTokens: Math.max(0, totalPrompt - cached),
    };
  }
}

// Auto-register for both server-side and browser variants.
{
  const strategy = new OpenAICacheStrategy();
  registerCacheStrategy(strategy);
  const browserStrategy: CacheStrategy = {
    providerName: 'browser-openai',
    capabilities: strategy.capabilities,
    prepareRequest: strategy.prepareRequest.bind(strategy),
    extractMetrics: strategy.extractMetrics.bind(strategy),
  };
  registerCacheStrategy(browserStrategy);
}
