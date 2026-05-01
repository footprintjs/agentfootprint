/**
 * NoOpCacheStrategy — fallback strategy for providers without cache
 * support (Mock, unknown providers, intentional opt-out).
 *
 * Returns the request unchanged; reports no metrics. The
 * `capabilities.enabled` flag is `false` so the CacheDecision subflow
 * could choose to skip emitting markers entirely (potential v2.7
 * optimization), though current Phase 4+5 always emit markers and
 * let the strategy decide what to do with them.
 *
 * Always-available default. Registered against the special wildcard
 * `'*'` so any unrecognized provider name falls back to NoOp.
 */

import type {
  CacheCapabilities,
  CacheMarker,
  CacheMetrics,
  CacheStrategy,
  CacheStrategyContext,
} from '../types.js';
import type { LLMRequest } from '../../adapters/types.js';

const NOOP_CAPABILITIES: CacheCapabilities = Object.freeze({
  enabled: false,
  maxMarkers: 0,
  ttls: [] as readonly ('short' | 'long')[],
  fields: [] as readonly ('system' | 'tools' | 'messages')[],
  automatic: false,
});

export class NoOpCacheStrategy implements CacheStrategy {
  /**
   * Wildcard provider name. The strategy registry treats this as the
   * fallback for any provider that doesn't have a specific strategy
   * registered.
   */
  readonly providerName = '*';
  readonly capabilities = NOOP_CAPABILITIES;

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

  extractMetrics(_usage: unknown): CacheMetrics | undefined {
    return undefined;
  }
}
