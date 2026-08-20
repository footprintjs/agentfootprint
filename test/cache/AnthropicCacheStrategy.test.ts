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
import { isKnown } from '../../src/lib/claim/claim.js';
import { AnthropicCacheStrategy } from '../../src/cache/strategies/AnthropicCacheStrategy';
import { getDefaultCacheStrategy } from '../../src/cache/strategyRegistry';
import type { CacheMarker, CacheStrategyContext } from '../../src/cache/types';
import type { LLMRequest } from '../../src/adapters/types';
import { expectScalesLinearly } from '../helpers/perf.js';

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

  it('an absent usage payload is UNKNOWN, with its reason — never a zero', () => {
    const c = s.extractMetrics(undefined);
    expect(c.kind).toBe('unknown');
    expect(c.kind === 'unknown' && c.reason).toMatch(/no usage payload/);
  });

  it('a usage payload with NO cache fields is "nobody measured", not "no cache traffic"', () => {
    // The distinction the whole meter rests on. An adapter sets cacheRead /
    // cacheWrite ONLY when the provider reported a number, so their ABSENCE is
    // information. Reading it as 0 is what produced a 0% hit rate for a turn
    // that hit cache on every call.
    const c = s.extractMetrics({ input: 100, output: 50 });
    expect(c.kind).toBe('unknown');
    expect(c.kind === 'unknown' && c.reason).toMatch(/nobody measured/);
  });

  it('a PRESENT zero is a real measurement and stays known', () => {
    const c = s.extractMetrics({ input: 100, output: 50, cacheRead: 0, cacheWrite: 0 });
    expect(c.kind).toBe('known');
    expect(isKnown(c) && c.value.cacheReadTokens).toBe(0);
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('AnthropicCacheStrategy — performance', () => {
  it(
    'clamping 1000 markers to 4 costs ten times what clamping 100 does',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The claim: the clamp is a single pass over the markers, not a re-sort
      // or a re-walk per marker kept. Ten times the markers, ten times the work.
      const s = new AnthropicCacheStrategy();
      const clamp = async (count: number): Promise<void> => {
        const markers = Array.from({ length: count }, () => m('system', 0));
        await s.prepareRequest(baseReq, markers, ctx());
      };
      await expectScalesLinearly({
        small: () => clamp(100),
        large: () => clamp(1000),
        scale: 10,
        why: 'marker clamping must be one pass, not a rescan per marker',
      });
    },
  );
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('AnthropicCacheStrategy — ROI: metrics extraction', () => {
  const s = new AnthropicCacheStrategy();

  // ── THE FIXTURES ARE PORT-SHAPED, AND THAT IS THE POINT ─────────────
  // Every fixture below feeds `{ input, output, cacheRead?, cacheWrite? }` —
  // what `agentfootprint.stream.llm_end` has ALWAYS carried. The pre-9.59.0
  // versions of these tests fed RAW WIRE names (`cache_read_input_tokens`,
  // `prompt_tokens_details`) which no strategy is ever handed, so the suite
  // stayed green while the shipped meter read `undefined` from every field and
  // recorded nothing. Wire-shaped fixtures are how this bug survived a release;
  // rebuilding them to port shape is what stops it coming back.

  it('reads a cache HIT off the port usage', () => {
    const c = s.extractMetrics({ input: 240, output: 50, cacheRead: 3000, cacheWrite: 0 });
    expect(isKnown(c)).toBe(true);
    expect(isKnown(c) && c.value.cacheReadTokens).toBe(3000);
    expect(isKnown(c) && c.value.cacheWriteTokens).toBe(0);
    expect(isKnown(c) && c.value.freshInputTokens).toBe(240);
  });

  it('reads a cache WRITE (the first call of a turn) off the port usage', () => {
    const c = s.extractMetrics({ input: 240, output: 50, cacheRead: 0, cacheWrite: 3200 });
    expect(isKnown(c) && c.value.cacheWriteTokens).toBe(3200);
    expect(isKnown(c) && c.value.cacheReadTokens).toBe(0);
  });

  it('a SILENT NON-CACHE is observable — measured zeros, not an absence', () => {
    // Below the model's minimum cacheable prefix the request is processed
    // WITHOUT caching and NO ERROR is returned. The adapter still reports the
    // fields, so this reads as a real measurement of zero cache traffic —
    // distinguishable from "the provider said nothing", which is the only way
    // a silent non-cache can be told apart from an unsupported adapter.
    const c = s.extractMetrics({ input: 400, output: 20, cacheRead: 0, cacheWrite: 0 });
    expect(isKnown(c)).toBe(true);
    expect(isKnown(c) && c.value.freshInputTokens).toBe(400);
    expect(s.extractMetrics({ input: 400, output: 20 }).kind).toBe('unknown');
  });
});
