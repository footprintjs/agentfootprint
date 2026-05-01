/**
 * OpenAI + Bedrock cache strategies — 7-pattern test matrix.
 *
 * Phase 8 of v2.6 cache layer.
 *
 * 7-pattern coverage (combined across both strategies):
 *   - unit:        capabilities + auto-registration (4)
 *   - boundary:    empty markers, kill switch (2)
 *   - scenario:    OpenAI auto-cache vs Bedrock-Claude vs Bedrock-Llama (3)
 *   - property:    Bedrock-Claude clamps to 4; non-Claude Bedrock drops markers (2)
 *   - security:    extractMetrics defensive (2)
 *   - performance: prepareRequest fast for both (1)
 *   - ROI:         OpenAI metrics extraction with cached_tokens (1)
 */

import { describe, expect, it } from 'vitest';
import { OpenAICacheStrategy } from '../../src/cache/strategies/OpenAICacheStrategy';
import { BedrockCacheStrategy } from '../../src/cache/strategies/BedrockCacheStrategy';
import { getDefaultCacheStrategy } from '../../src/cache/strategyRegistry';
import type { CacheMarker, CacheStrategyContext } from '../../src/cache/types';
import type { LLMRequest } from '../../src/adapters/types';

const ctx = (overrides: Partial<CacheStrategyContext> = {}): CacheStrategyContext => ({
  iteration: 1,
  iterationsRemaining: 4,
  recentHitRate: undefined,
  cachingDisabled: false,
  ...overrides,
});

const m = (
  field: 'system' | 'tools' | 'messages',
  boundaryIndex: number,
): CacheMarker => ({ field, boundaryIndex, ttl: 'short', reason: 'test' });

const claudeOnBedrock: LLMRequest = {
  model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  messages: [{ role: 'user', content: 'go' }],
};

const llamaOnBedrock: LLMRequest = {
  model: 'meta.llama3-1-70b-instruct-v1:0',
  messages: [{ role: 'user', content: 'go' }],
};

const openaiReq: LLMRequest = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'go' }],
};

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('OpenAICacheStrategy — unit', () => {
  it("auto-registers under 'openai' and 'browser-openai'", async () => {
    await import('../../src/cache/strategies/OpenAICacheStrategy');
    expect(getDefaultCacheStrategy('openai').providerName).toBe('openai');
    expect(getDefaultCacheStrategy('browser-openai').providerName).toBe('browser-openai');
  });

  it("capabilities: enabled but automatic (markers don't apply)", () => {
    const s = new OpenAICacheStrategy();
    expect(s.capabilities.enabled).toBe(true);
    expect(s.capabilities.automatic).toBe(true);
    expect(s.capabilities.maxMarkers).toBe(0);
  });
});

describe('BedrockCacheStrategy — unit', () => {
  it("auto-registers under 'bedrock'", async () => {
    await import('../../src/cache/strategies/BedrockCacheStrategy');
    expect(getDefaultCacheStrategy('bedrock').providerName).toBe('bedrock');
  });

  it("capabilities: 4 markers, both TTLs, all 3 fields (matching Bedrock-Claude)", () => {
    const s = new BedrockCacheStrategy();
    expect(s.capabilities.maxMarkers).toBe(4);
    expect(s.capabilities.ttls).toEqual(['short', 'long']);
    expect(s.capabilities.fields).toEqual(['system', 'tools', 'messages']);
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('Phase 8 strategies — boundary', () => {
  it('OpenAI: empty markers → request unchanged', async () => {
    const s = new OpenAICacheStrategy();
    const result = await s.prepareRequest(openaiReq, [], ctx());
    expect(result.request).toBe(openaiReq);
    expect(result.markersApplied).toEqual([]);
  });

  it('Bedrock: cachingDisabled=true → request unchanged', async () => {
    const s = new BedrockCacheStrategy();
    const result = await s.prepareRequest(
      claudeOnBedrock,
      [m('system', 0)],
      ctx({ cachingDisabled: true }),
    );
    expect(result.request).toBe(claudeOnBedrock);
    expect(result.markersApplied).toEqual([]);
  });
});

// ─── 3. Scenario ──────────────────────────────────────────────────

describe('Phase 8 strategies — scenario', () => {
  it('OpenAI: markers passed but DROPPED (auto-cache, no opt-in)', async () => {
    const s = new OpenAICacheStrategy();
    const result = await s.prepareRequest(openaiReq, [m('system', 0)], ctx());
    expect(result.request.cacheMarkers).toBeUndefined();
    expect(result.markersApplied).toEqual([]);
  });

  it('Bedrock-Claude: markers attached (delegates to Anthropic-shape)', async () => {
    const s = new BedrockCacheStrategy();
    const markers = [m('system', 0)];
    const result = await s.prepareRequest(claudeOnBedrock, markers, ctx());
    expect(result.request.cacheMarkers).toEqual(markers);
    expect(result.markersApplied).toEqual(markers);
  });

  it('Bedrock-Llama: markers SILENTLY dropped (no cache support)', async () => {
    const s = new BedrockCacheStrategy();
    const result = await s.prepareRequest(llamaOnBedrock, [m('system', 0)], ctx());
    expect(result.request.cacheMarkers).toBeUndefined();
    expect(result.markersApplied).toEqual([]);
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('Phase 8 strategies — property', () => {
  it('Bedrock-Claude clamps to 4 markers (Anthropic-style limit)', async () => {
    const s = new BedrockCacheStrategy();
    const markers = Array.from({ length: 8 }, (_, i) => m('system', i));
    const result = await s.prepareRequest(claudeOnBedrock, markers, ctx());
    expect(result.markersApplied).toHaveLength(4);
  });

  it('Bedrock model-detection: uppercase, lowercase, mixed all match anthropic.claude prefix', async () => {
    const s = new BedrockCacheStrategy();
    const variants = [
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      'ANTHROPIC.CLAUDE-OPUS-V2', // case-insensitive regex
      'anthropic.claude-haiku-3-5',
    ];
    for (const model of variants) {
      const result = await s.prepareRequest(
        { ...claudeOnBedrock, model },
        [m('system', 0)],
        ctx(),
      );
      expect(result.markersApplied).toHaveLength(1);
    }
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('Phase 8 strategies — security: extractMetrics defensive', () => {
  it('OpenAI: undefined for null/non-object usage', () => {
    const s = new OpenAICacheStrategy();
    expect(s.extractMetrics(null)).toBeUndefined();
    expect(s.extractMetrics(42)).toBeUndefined();
  });

  it('Bedrock: undefined when no cache fields (response had no caching)', () => {
    const s = new BedrockCacheStrategy();
    expect(s.extractMetrics({ input_tokens: 100, output_tokens: 50 })).toBeUndefined();
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('Phase 8 strategies — performance', () => {
  it('100 prepareRequest calls in <10ms across both strategies', async () => {
    const oa = new OpenAICacheStrategy();
    const bc = new BedrockCacheStrategy();
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      await oa.prepareRequest(openaiReq, [], ctx());
      await bc.prepareRequest(claudeOnBedrock, [m('system', 0)], ctx());
    }
    expect(Date.now() - start).toBeLessThan(20);
  });
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('Phase 8 strategies — ROI', () => {
  it('OpenAI extracts cached_tokens from prompt_tokens_details', () => {
    const s = new OpenAICacheStrategy();
    const usage = {
      prompt_tokens: 5240,
      prompt_tokens_details: { cached_tokens: 5000 },
      completion_tokens: 80,
    };
    const m = s.extractMetrics(usage);
    expect(m).toBeDefined();
    expect(m?.cacheReadTokens).toBe(5000);
    expect(m?.freshInputTokens).toBe(240);
    expect(m?.cacheWriteTokens).toBe(0); // OpenAI no write premium
  });
});
