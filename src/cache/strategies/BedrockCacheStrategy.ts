/**
 * BedrockCacheStrategy — REGISTERED, AND HONEST ABOUT DOING NOTHING (9.59.0).
 *
 * What Bedrock supports and what THIS ADAPTER does are two different facts,
 * and until 9.59.0 the strategy stated the first while the runtime lived
 * under the second:
 *
 *   - AWS's Converse API does support prompt caching for Claude models
 *     (`cachePoint: { type: 'default' }` entries inserted into the `system` /
 *     `tools` / `messages` arrays) and does report
 *     `cacheReadInputTokens` / `cacheWriteInputTokens` in its usage block.
 *   - `BedrockProvider` implements NEITHER half. It never reads
 *     `req.cacheMarkers` (compare `AnthropicProvider`, which calls
 *     `applyCacheMarkers`) and it builds `usage` as `{ input, output }` at
 *     both its streaming and non-streaming sites. The string "cache" does
 *     not appear in that file.
 *
 * So this strategy used to clamp markers onto a request field the adapter
 * then discarded, and report `markersApplied` for markers that never reached
 * a wire — a meter attached to a provider that cannot feed it. It now:
 *
 *   - declares `enabled: false` (nothing here works end to end);
 *   - passes the request through with `markersApplied: []`, and says why
 *     once, in dev mode;
 *   - answers `extractMetrics` with `not-applicable` and the reason.
 *
 * It stays REGISTERED rather than being deleted so that a Bedrock consumer
 * asking the registry what it got is told the truth by name, instead of
 * silently falling through to the wildcard NoOp and being left to guess.
 *
 * Note on Converse: the send half is genuinely a DIFFERENT wire from
 * Anthropic's `cache_control` block, so implementing it wants its own
 * `bedrockCacheWire.ts` beside `anthropicCacheWire.ts` — not a reuse. That
 * is the follow-up this file is waiting for; when it lands, flip `enabled`
 * and give `extractMetrics` the `readPortCacheUsage` body the Anthropic
 * strategy has.
 *
 * Auto-registers under provider name `'bedrock'`.
 */

import type {
  CacheCapabilities,
  CacheMarker,
  CacheMetrics,
  CacheStrategy,
  CacheStrategyContext,
  CacheUsage,
} from '../types.js';
import { notApplicable, type Claim } from '../../lib/claim/claim.js';
import type { LLMRequest } from '../../adapters/types.js';
import { registerCacheStrategy } from '../strategyRegistry.js';
import { isDevMode } from 'footprintjs';

const BEDROCK_CAPABILITIES: CacheCapabilities = Object.freeze({
  // `false`, and it is a statement about the ADAPTER, not about Bedrock.
  // Bedrock-Claude supports prompt caching; `BedrockProvider` implements
  // neither half of the contract (never sends markers, never reads cache
  // usage), so nothing this strategy could do would reach a wire. Saying
  // `true` here is what let a dead meter look alive.
  enabled: false,
  maxMarkers: 0,
  ttls: [] as readonly ('short' | 'long')[],
  fields: [] as readonly ('system' | 'tools' | 'messages')[],
  automatic: false,
});

/** One warning per process, not one per call — the fact does not change. */
let warnedAboutAdapterGap = false;

export class BedrockCacheStrategy implements CacheStrategy {
  readonly providerName = 'bedrock';
  readonly capabilities = BEDROCK_CAPABILITIES;

  async prepareRequest(
    req: LLMRequest,
    candidates: readonly CacheMarker[],
    _ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }> {
    // Pass-through, ALWAYS. Writing `req.cacheMarkers` here would be writing
    // to a field `BedrockProvider` never reads, and returning a non-empty
    // `markersApplied` would put markers that never reached a wire onto the
    // recorder's record.
    if (candidates.length > 0 && !warnedAboutAdapterGap && isDevMode()) {
      warnedAboutAdapterGap = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[agentfootprint] cache: ${candidates.length} cache marker(s) were declared for ` +
          `model "${req.model}", but the Bedrock adapter does not implement prompt caching — ` +
          `it never sends cachePoint entries and never reads cacheReadInputTokens off the ` +
          `Converse response. No markers were applied and no hit rate can be measured. ` +
          `Your cache: directives stay portable and light up on the Anthropic providers.`,
      );
    }
    return { request: req, markersApplied: [] };
  }

  /**
   * Always `not-applicable` — and that is a statement about THIS adapter,
   * not about Bedrock. AWS's Converse API does report
   * `cacheReadInputTokens` / `cacheWriteInputTokens`, but
   * `BedrockProvider` never reads them: its `usage` is built as
   * `{ input, output }` at both the streaming and non-streaming sites. So
   * `cacheRead`/`cacheWrite` are ALWAYS absent on this port, and an
   * `unknown` per call would read as a measurement that merely failed.
   * `not-applicable` says the true thing: nothing here can be measured
   * until the adapter grows the read half.
   */
  extractMetrics(_usage: CacheUsage | undefined): Claim<CacheMetrics> {
    return notApplicable(
      'the Bedrock adapter does not read cache usage off the Converse response, so no ' +
        'cache tokens ever reach the port',
    );
  }
}

registerCacheStrategy(new BedrockCacheStrategy());
