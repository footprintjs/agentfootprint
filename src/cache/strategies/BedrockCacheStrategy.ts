/**
 * BedrockCacheStrategy — model-aware strategy for AWS Bedrock.
 *
 * Bedrock hosts multiple model families. Cache support varies:
 *   - Claude on Bedrock → identical mechanics to direct Anthropic
 *     (`cache_control: { type: 'ephemeral' }` markers, 4-marker
 *     limit). Strategy delegates to Anthropic-shaped behavior.
 *   - Llama / Mistral / Cohere on Bedrock → no cache support today
 *     (as of 2026-04-30). Strategy passes through, returns no metrics.
 *
 * Auto-detection: inspects `req.model` to decide. Claude model IDs
 * start with `'anthropic.claude'` on Bedrock (e.g.,
 * `anthropic.claude-3-5-sonnet-20240620-v1:0`).
 *
 * Auto-registers under provider name `'bedrock'`.
 *
 * Per the Phase 1 review (Reviewer 6 — Provider SDK expert): for
 * non-Claude Bedrock models the strategy reports `enabled: false` in
 * its capabilities so the CacheDecision subflow can short-circuit
 * marker emission (potential v2.7 optimization). Today markers still
 * emit and we drop them silently in prepareRequest.
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

/** Match Bedrock-Claude model ids: `anthropic.claude-...` */
const BEDROCK_CLAUDE_RE = /^anthropic\.claude/i;

/** Anthropic's 4-marker limit applies to Bedrock-Claude too. */
const BEDROCK_MAX_MARKERS = 4;

const BEDROCK_CAPABILITIES: CacheCapabilities = Object.freeze({
  // We say `enabled: true` at the capability level because Bedrock-
  // Claude DOES support caching. Bedrock-Llama/Mistral land in the
  // model-aware code path inside prepareRequest (no markers applied).
  enabled: true,
  maxMarkers: BEDROCK_MAX_MARKERS,
  ttls: ['short', 'long'] as readonly ('short' | 'long')[],
  fields: ['system', 'tools', 'messages'] as readonly (
    | 'system'
    | 'tools'
    | 'messages'
  )[],
  automatic: false,
});

export class BedrockCacheStrategy implements CacheStrategy {
  readonly providerName = 'bedrock';
  readonly capabilities = BEDROCK_CAPABILITIES;

  async prepareRequest(
    req: LLMRequest,
    candidates: readonly CacheMarker[],
    ctx: CacheStrategyContext,
  ): Promise<{
    readonly request: LLMRequest;
    readonly markersApplied: readonly CacheMarker[];
  }> {
    if (ctx.cachingDisabled || candidates.length === 0) {
      return { request: req, markersApplied: [] };
    }
    // Model-aware: only Claude on Bedrock supports cache_control.
    // Other model families silently drop the markers.
    if (!BEDROCK_CLAUDE_RE.test(req.model)) {
      return { request: req, markersApplied: [] };
    }
    const markersApplied =
      candidates.length <= BEDROCK_MAX_MARKERS
        ? candidates
        : candidates.slice(0, BEDROCK_MAX_MARKERS);
    return {
      request: { ...req, cacheMarkers: markersApplied },
      markersApplied,
    };
  }

  extractMetrics(usage: unknown): CacheMetrics | undefined {
    // Bedrock returns the SAME usage shape as Anthropic for Claude
    // models — same cache_creation_input_tokens / cache_read_input_tokens
    // fields. Reuse identical extraction.
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    if (cacheRead === 0 && cacheWrite === 0) return undefined;
    return {
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      freshInputTokens: u.input_tokens ?? 0,
    };
  }
}

registerCacheStrategy(new BedrockCacheStrategy());
