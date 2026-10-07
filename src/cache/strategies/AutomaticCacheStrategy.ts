/**
 * AutomaticCacheStrategy — for a provider that caches repeated prefixes on
 * its own (`promptCaching.mode: 'automatic'`; OpenAI, Azure OpenAI).
 *
 * Chosen by CAPABILITY (`cacheStrategyFor`), never by provider name.
 *
 *   - **prepareRequest**: pass-through. The provider decides what to cache;
 *     a marker would mean nothing on its wire. The `cache:` policies on
 *     injections still matter — they travel with the agent and take effect
 *     the moment it runs on a breakpoint provider — but here they have no
 *     local effect, and `cache: 'never'` cannot stop the provider caching.
 *   - **extractMetrics**: the port usage when the adapter declares it
 *     reports cache tokens; `not applicable` when it declares it does not
 *     (the OpenAI adapter does not lift `prompt_tokens_details.cached_tokens`
 *     yet — named, rather than hidden behind a per-call `unknown` that would
 *     suggest the measurement was attempted).
 */

import type {
  CacheMarker,
  CacheMetrics,
  CacheStrategy,
  CacheStrategyContext,
  CacheUsage,
} from '../types.js';
import { notApplicable, type Claim } from '../../lib/claim/claim.js';
import { readPortCacheUsage } from '../portUsage.js';
import type { LLMRequest, PromptCaching } from '../../adapters/types.js';

export class AutomaticCacheStrategy implements CacheStrategy {
  readonly name = 'automatic';
  private readonly reportsUsage: boolean;
  private readonly who: string;

  /**
   * @param declared  the provider's `promptCaching` declaration
   * @param who       names the adapter in the meter's evidence sentences
   */
  constructor(declared: Extract<PromptCaching, { mode: 'automatic' }>, who = 'the provider') {
    this.reportsUsage = declared.reportsUsage;
    this.who = who;
  }

  async prepareRequest(
    req: LLMRequest,
    _candidates: readonly CacheMarker[],
    _ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }> {
    return { request: req, markersApplied: [] };
  }

  extractMetrics(usage: CacheUsage | undefined): Claim<CacheMetrics> {
    if (!this.reportsUsage) {
      return notApplicable(
        `${this.who} caches automatically but declares that it does not report cache ` +
          'token counts (promptCaching.reportsUsage: false)',
      );
    }
    return readPortCacheUsage(usage, this.who);
  }
}
