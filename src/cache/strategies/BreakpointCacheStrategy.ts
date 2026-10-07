/**
 * BreakpointCacheStrategy — for a provider that caches a prefix only where
 * the request marks it (`promptCaching.mode: 'breakpoints'`; Anthropic's
 * `cache_control`).
 *
 * Chosen by CAPABILITY (`cacheStrategyFor`), never by provider name: built
 * from the provider's own declaration, so `withRetry(anthropic())` or an
 * application's routing wrapper caches exactly like the adapter it wraps.
 *
 * What it DOES:
 *   - clamp the candidate markers to the declared `maxBreakpoints`, keeping
 *     the first N in slot order (the most stable prefixes first);
 *   - put them on `LLMRequest.cacheMarkers`, where the adapter reads them;
 *   - read cache metrics off the PORT usage the adapter normalised —
 *     `not applicable` when the declaration says the adapter reports none.
 * What it does NOT: touch the wire. The adapter owns `cache_control`
 * (`adapters/llm/anthropicCacheWire.ts`), and content is never edited.
 */

import type {
  CacheMarker,
  CacheMetrics,
  CacheStrategy,
  CacheStrategyContext,
  CacheUsage,
  PromptCaching,
} from '../types.js';
import { notApplicable, type Claim } from '../../lib/claim/claim.js';
import { readPortCacheUsage } from '../portUsage.js';
import type { LLMRequest } from '../../adapters/types.js';

export class BreakpointCacheStrategy implements CacheStrategy {
  readonly name = 'breakpoints';
  private readonly maxBreakpoints: number;
  private readonly reportsUsage: boolean;
  private readonly who: string;

  /**
   * @param declared  the provider's `promptCaching` declaration
   * @param who       names the adapter in the meter's evidence sentences,
   *                  e.g. `"the 'anthropic' provider"`
   */
  constructor(declared: Extract<PromptCaching, { mode: 'breakpoints' }>, who = 'the provider') {
    this.maxBreakpoints = declared.maxBreakpoints;
    this.reportsUsage = declared.reportsUsage;
    this.who = who;
  }

  async prepareRequest(
    req: LLMRequest,
    candidates: readonly CacheMarker[],
    ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }> {
    // The agent-side kill switch, honoured here too: the CacheGate should
    // already have emptied the candidates, but a buggy gate must not be able
    // to put markers on a request whose run said caching is off.
    if (ctx.cachingDisabled || candidates.length === 0) {
      return { request: req, markersApplied: [] };
    }
    const markersApplied =
      candidates.length <= this.maxBreakpoints
        ? candidates
        : candidates.slice(0, this.maxBreakpoints);
    return { request: { ...req, cacheMarkers: markersApplied }, markersApplied };
  }

  extractMetrics(usage: CacheUsage | undefined): Claim<CacheMetrics> {
    if (!this.reportsUsage) {
      return notApplicable(
        `${this.who} declares that it does not report cache token counts ` +
          '(promptCaching.reportsUsage: false)',
      );
    }
    return readPortCacheUsage(usage, this.who);
  }
}
