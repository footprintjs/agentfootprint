/**
 * AnthropicCacheStrategy — 7-pattern test matrix.
 *
 * Phase 7 of v2.6 cache layer. Tests:
 *   1. unit:        capabilities + provider name + auto-registration
 *   2. boundary:    empty markers, kill switch
 *   3. scenario:    realistic 1-2-3 marker cases
 *   4. property:    4-marker cap + markersApplied ⊆ candidates
 *   5. security:    extractMetrics defensive against malformed usage
 *   6. performance: clamping is O(N)
 *   7. ROI:         metrics extraction with cache write/read fields
 */

import { describe, expect, it } from 'vitest';
import { AnthropicCacheStrategy } from '../../src/cache/strategies/AnthropicCacheStrategy';
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

const baseReq: LLMRequest = {
  systemPrompt: 'You are a test agent.',
  messages: [{ role: 'user', content: 'go' }],
  model: 'claude-sonnet-4-5-20250929',
};

const m = (
  field: 'system' | 'tools' | 'messages',
  boundaryIndex: number,
  ttl: 'short' | 'long' = 'short',
): CacheMarker => ({ field, boundaryIndex, ttl, reason: 'test' });

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('AnthropicCacheStrategy — unit', () => {
  it('capabilities: enabled, 4 markers, both TTLs, all 3 fields', () => {
    const s = new AnthropicCacheStrategy();
    expect(s.capabilities.enabled).toBe(true);
    expect(s.capabilities.maxMarkers).toBe(4);
    expect(s.capabilities.ttls).toEqual(['short', 'long']);
    expect(s.capabilities.fields).toEqual(['system', 'tools', 'messages']);
    expect(s.capabilities.automatic).toBe(false);
  });

  it("auto-registers under 'anthropic'", async () => {
    // Force module load (idempotent thanks to module caching)
    await import('../../src/cache/strategies/AnthropicCacheStrategy');
    const s = getDefaultCacheStrategy('anthropic');
    expect(s.providerName).toBe('anthropic');
    expect(s.capabilities.enabled).toBe(true);
  });

  it("auto-registers under 'browser-anthropic'", async () => {
    await import('../../src/cache/strategies/AnthropicCacheStrategy');
    const s = getDefaultCacheStrategy('browser-anthropic');
    expect(s.providerName).toBe('browser-anthropic');
    expect(s.capabilities.enabled).toBe(true);
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('AnthropicCacheStrategy — boundary', () => {
  it('empty markers → request unchanged, no markers applied', async () => {
    const s = new AnthropicCacheStrategy();
    const result = await s.prepareRequest(baseReq, [], ctx());
    expect(result.request).toBe(baseReq); // same reference (pure pass-through)
    expect(result.markersApplied).toEqual([]);
  });

  it('cachingDisabled=true → request unchanged regardless of markers', async () => {
    const s = new AnthropicCacheStrategy();
    const result = await s.prepareRequest(
      baseReq,
      [m('system', 0)],
      ctx({ cachingDisabled: true }),
    );
    expect(result.request).toBe(baseReq);
    expect(result.markersApplied).toEqual([]);
  });
});

// ─── 3. Scenario ──────────────────────────────────────────────────

describe('AnthropicCacheStrategy — scenario', () => {
  it('1 system marker → request gets cacheMarkers field with 1 entry', async () => {
    const s = new AnthropicCacheStrategy();
    const markers = [m('system', 0)];
    const result = await s.prepareRequest(baseReq, markers, ctx());
    expect(result.request.cacheMarkers).toEqual(markers);
    expect(result.markersApplied).toEqual(markers);
  });

  it('2 markers (system + tools) → both attached', async () => {
    const s = new AnthropicCacheStrategy();
    const markers = [m('system', 4), m('tools', 1)];
    const result = await s.prepareRequest(baseReq, markers, ctx());
    expect(result.request.cacheMarkers).toEqual(markers);
  });

  it('long TTL marker preserved through prepareRequest', async () => {
    const s = new AnthropicCacheStrategy();
    const markers = [m('system', 0, 'long')];
    const result = await s.prepareRequest(baseReq, markers, ctx());
    expect(result.request.cacheMarkers?.[0].ttl).toBe('long');
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('AnthropicCacheStrategy — property', () => {
  it('clamps to 4 markers max (Anthropic limit)', async () => {
    const s = new AnthropicCacheStrategy();
    const markers = [
      m('system', 0),
      m('tools', 0),
      m('messages', 0),
      m('system', 1),
      m('system', 2),
      m('tools', 1),
    ];
    const result = await s.prepareRequest(baseReq, markers, ctx());
    expect(result.markersApplied).toHaveLength(4);
    expect(result.request.cacheMarkers).toHaveLength(4);
  });

  it('markersApplied is always a SUBSET of candidates (never invents)', async () => {
    const s = new AnthropicCacheStrategy();
    const markers = [m('system', 0), m('tools', 0)];
    const result = await s.prepareRequest(baseReq, markers, ctx());
    for (const applied of result.markersApplied) {
      expect(markers).toContain(applied);
    }
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('AnthropicCacheStrategy — security: extractMetrics defensive', () => {
  const s = new AnthropicCacheStrategy();

  it('returns undefined for null usage', () => {
    expect(s.extractMetrics(null)).toBeUndefined();
  });

  it('returns undefined for non-object usage', () => {
    expect(s.extractMetrics('not an object')).toBeUndefined();
    expect(s.extractMetrics(42)).toBeUndefined();
  });

  it('returns undefined when no cache fields present (response had no caching)', () => {
    expect(s.extractMetrics({ input_tokens: 100, output_tokens: 50 })).toBeUndefined();
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('AnthropicCacheStrategy — performance', () => {
  it('1000 markers clamp to 4 in <5ms', async () => {
    const s = new AnthropicCacheStrategy();
    const markers = Array.from({ length: 1000 }, () => m('system', 0));
    const start = Date.now();
    await s.prepareRequest(baseReq, markers, ctx());
    expect(Date.now() - start).toBeLessThan(5);
  });
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('AnthropicCacheStrategy — ROI: metrics extraction', () => {
  const s = new AnthropicCacheStrategy();

  it('extracts cache_creation_input_tokens (write) + cache_read_input_tokens (read)', () => {
    const usage = {
      input_tokens: 240,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3000,
      output_tokens: 50,
    };
    const m = s.extractMetrics(usage);
    expect(m).toBeDefined();
    expect(m?.cacheReadTokens).toBe(3000);
    expect(m?.cacheWriteTokens).toBe(0);
    expect(m?.freshInputTokens).toBe(240);
  });

  it('extracts cache_creation (first iter — cache write)', () => {
    const usage = {
      input_tokens: 240,
      cache_creation_input_tokens: 3200,
      cache_read_input_tokens: 0,
      output_tokens: 50,
    };
    const m = s.extractMetrics(usage);
    expect(m?.cacheWriteTokens).toBe(3200);
    expect(m?.cacheReadTokens).toBe(0);
  });
});
