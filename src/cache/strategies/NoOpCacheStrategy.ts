/**
 * NoOpCacheStrategy — for a provider that declares no prompt caching
 * (`LLMProvider.promptCaching` absent): Mock, Ollama, Bedrock Converse,
 * any adapter that has not said, or an intentional opt-out.
 *
 * Returns the request unchanged and reports *not applicable* — never a zero.
 * Chosen by `cacheStrategyFor` when the declaration is absent; one shared
 * instance serves every such provider (it holds no state).
 */

import type {
  CacheMarker,
  CacheMetrics,
  CacheStrategy,
  CacheStrategyContext,
  CacheUsage,
} from '../types.js';
import { notApplicable, type Claim } from '../../lib/claim/claim.js';
import type { LLMRequest } from '../../adapters/types.js';

export class NoOpCacheStrategy implements CacheStrategy {
  readonly name = 'none';

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

  extractMetrics(_usage: CacheUsage | undefined): Claim<CacheMetrics> {
    return notApplicable(
      'the provider declares no prompt caching (LLMProvider.promptCaching is absent), so no ' +
        'cache traffic is driven or reported',
    );
  }
}
