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
import { expectScalesLinearly } from '../helpers/perf.js';

const ctx = (overrides: Partial<CacheStrategyContext> = {}): CacheStrategyContext => ({
  iteration: 1,
  iterationsRemaining: 4,
  recentHitRate: undefined,
  cachingDisabled: false,
  ...overrides,
});

const m = (field: 'system' | 'tools' | 'messages', boundaryIndex: number): CacheMarker => ({
  field,
  boundaryIndex,
  ttl: 'short',
  reason: 'test',
});

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

  it('capabilities say FALSE — a statement about the ADAPTER, not about Bedrock', () => {
    // AWS's Converse API does support prompt caching for Claude models and does
    // report cacheReadInputTokens. `BedrockProvider` implements NEITHER half:
    // it never reads req.cacheMarkers and it builds usage as { input, output }
    // at both its streaming and non-streaming sites. Claiming `enabled: true`
    // here is what let a dead meter look alive — a strategy clamping markers
    // onto a field the adapter then discarded, and reporting markersApplied for
    // markers that never reached a wire.
    const s = new BedrockCacheStrategy();
    expect(s.capabilities.enabled).toBe(false);
    expect(s.capabilities.maxMarkers).toBe(0);
    expect(s.capabilities.ttls).toEqual([]);
    expect(s.capabilities.fields).toEqual([]);
  });

  it('stays REGISTERED, so a Bedrock consumer is told the truth by name', () => {
    // Deleting it would fall through to the wildcard NoOp and leave the
    // consumer to guess. Never leave a meter attached to a provider that
    // cannot feed it — and never hide that it cannot.
    expect(getDefaultCacheStrategy('bedrock').providerName).toBe('bedrock');
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

  it('Bedrock-Claude: markers are NOT attached — the adapter would discard them', async () => {
    const s = new BedrockCacheStrategy();
    const markers = [m('system', 0)];
    const result = await s.prepareRequest(claudeOnBedrock, markers, ctx());
    // Writing req.cacheMarkers would be writing to a field BedrockProvider
    // never reads; returning a non-empty markersApplied would put markers that
    // never reached a wire onto the recorder's record.
    expect(result.request.cacheMarkers).toBeUndefined();
    expect(result.markersApplied).toEqual([]);
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
  it('EVERY Bedrock model passes through — no model-detection theatre', async () => {
    // The old strategy branched on `anthropic.claude*` and clamped to 4. Both
    // halves were fiction: the adapter reads neither the markers nor the cache
    // usage, so the model id changes nothing about what reaches a wire.
    const s = new BedrockCacheStrategy();
    const models = [
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
      'ANTHROPIC.CLAUDE-OPUS-V2',
      'meta.llama3-70b-instruct-v1:0',
    ];
    for (const model of models) {
      const markers = Array.from({ length: 8 }, (_, i) => m('system', i));
      const result = await s.prepareRequest({ ...claudeOnBedrock, model }, markers, ctx());
      expect(result.markersApplied).toEqual([]);
      expect(result.request.cacheMarkers).toBeUndefined();
    }
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('Phase 8 strategies — security: extractMetrics is honest about WHY', () => {
  // NOT-APPLICABLE vs UNKNOWN is the distinction these two arms exist for.
  // `unknown` says "a measurement was attempted and came back empty";
  // `not-applicable` says "nothing here can be measured at all". Reporting a
  // per-call `unknown` for an adapter that structurally cannot report would
  // suggest the former, and a reader would go looking for a flaky provider.
  it('OpenAI: NOT-APPLICABLE, naming the adapter gap', () => {
    const s = new OpenAICacheStrategy();
    const c = s.extractMetrics({ input: 100, output: 50 });
    expect(c.kind).toBe('not-applicable');
    expect(c.kind === 'not-applicable' && c.evidence).toMatch(/prompt_tokens_details/);
  });

  it('Bedrock: NOT-APPLICABLE, naming the adapter gap', () => {
    const s = new BedrockCacheStrategy();
    const c = s.extractMetrics({ input: 100, output: 50, cacheRead: 9 });
    // Even handed a cacheRead it answers not-applicable: BedrockProvider never
    // puts one there, so a number in that position did not come from Bedrock.
    expect(c.kind).toBe('not-applicable');
    expect(c.kind === 'not-applicable' && c.evidence).toMatch(/Converse/);
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('Phase 8 strategies — performance', () => {
  it(
    'prepareRequest cost stays flat as calls pile up (both strategies)',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Both strategies are pure request transforms — they hold no per-call
      // state — so ten times the calls must cost ten times the work.
      const oa = new OpenAICacheStrategy();
      const bc = new BedrockCacheStrategy();
      const prepare = async (calls: number): Promise<void> => {
        for (let i = 0; i < calls; i++) {
          await oa.prepareRequest(openaiReq, [], ctx());
          await bc.prepareRequest(claudeOnBedrock, [m('system', 0)], ctx());
        }
      };
      await expectScalesLinearly({
        small: () => prepare(100),
        large: () => prepare(1000),
        scale: 10,
        why: 'cache strategies must stay stateless per call',
      });
    },
  );
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('Phase 8 strategies — ROI: the costliest gap is NAMED, not hidden', () => {
  it('OpenAI says what is missing and where, in one sentence', () => {
    // OpenAI is the AUTO-caching provider, so this is the most expensive of
    // the three adapter gaps: caching is happening on every call and nothing
    // measures it. Named here rather than buried behind a per-call `unknown`.
    const s = new OpenAICacheStrategy();
    const c = s.extractMetrics({ input: 5240, output: 80 });
    expect(c.kind).toBe('not-applicable');
    expect(c.kind === 'not-applicable' && c.evidence).toMatch(/adapter does not lift/);
  });
});
