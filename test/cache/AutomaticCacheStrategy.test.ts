/**
 * AutomaticCacheStrategy + the providers that declare NO caching — 7-pattern
 * test matrix.
 *
 * `mode: 'automatic'` is OpenAI's wire: the provider caches on its own, so the
 * strategy passes the request through and the meter says what the adapter
 * can report. A provider that declares nothing (Bedrock Converse, Ollama,
 * Mock) gets the no-op strategy — a statement about the ADAPTER, never about
 * the vendor: AWS's Converse API can cache Claude prompts, and this Bedrock
 * adapter implements neither half, so it does not declare it.
 *
 *   - unit:        name + which adapters select it
 *   - boundary:    empty markers, kill switch
 *   - scenario:    markers handed to an automatic provider are dropped
 *   - property:    pass-through for every candidate set
 *   - security:    extractMetrics names WHY it cannot measure
 *   - performance: prepareRequest stays flat
 *   - ROI:         a reporting automatic adapter is metered end to end
 */

import { describe, expect, it } from 'vitest';
import { AutomaticCacheStrategy } from '../../src/cache/strategies/AutomaticCacheStrategy';
import { NoOpCacheStrategy } from '../../src/cache/strategies/NoOpCacheStrategy';
import { cacheStrategyFor } from '../../src/cache/cacheStrategyFor';
import type { CacheMarker, CacheStrategyContext } from '../../src/cache/types';
import type { LLMRequest } from '../../src/adapters/types';
import { openai } from '../../src/adapters/llm/OpenAIProvider';
import { bedrock } from '../../src/adapters/llm/BedrockProvider';
import { ollama } from '../../src/adapters/llm/OllamaProvider';
import { mock } from '../../src/adapters/llm/MockProvider';
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

const req: LLMRequest = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
const fakeClient = { chat: { completions: { create: async () => ({}) } } } as never;
const OPENAI = new AutomaticCacheStrategy(
  { mode: 'automatic', reportsUsage: false },
  'the OpenAI adapter',
);

// ─── 1. Unit ──────────────────────────────────────────────────────

describe('AutomaticCacheStrategy — unit', () => {
  it("names the capability it serves — 'automatic'", () => {
    expect(OPENAI.name).toBe('automatic');
  });

  it('is what openai() selects; Bedrock, Ollama and Mock declare nothing and get none', () => {
    expect(cacheStrategyFor(openai({ _client: fakeClient }))).toBeInstanceOf(
      AutomaticCacheStrategy,
    );
    for (const p of [
      bedrock({ _client: {} as never, _commands: {} as never }),
      ollama({ model: 'llama3' }),
      mock({ reply: 'x' }),
    ]) {
      expect(p.promptCaching, p.name).toBe(undefined);
      expect(cacheStrategyFor(p), p.name).toBeInstanceOf(NoOpCacheStrategy);
    }
  });
});

// ─── 2. Boundary ──────────────────────────────────────────────────

describe('AutomaticCacheStrategy — boundary', () => {
  it('empty markers → request unchanged', async () => {
    const out = await OPENAI.prepareRequest(req, [], ctx());
    expect(out.request).toBe(req);
    expect(out.markersApplied).toEqual([]);
  });

  it('cachingDisabled → request unchanged (the provider may still cache on its own)', async () => {
    const out = await OPENAI.prepareRequest(req, [m('system', 0)], ctx({ cachingDisabled: true }));
    expect(out.request).toBe(req);
  });
});

// ─── 3. Scenario ──────────────────────────────────────────────────

describe('AutomaticCacheStrategy — scenario', () => {
  it('markers handed to an automatic provider are dropped — nothing to mark on its wire', async () => {
    const out = await OPENAI.prepareRequest(req, [m('system', 0), m('messages', 0)], ctx());
    expect(out.request).toBe(req);
    expect(out.request.cacheMarkers).toBeUndefined();
    expect(out.markersApplied).toEqual([]);
  });
});

// ─── 4. Property ──────────────────────────────────────────────────

describe('AutomaticCacheStrategy — property', () => {
  it('every candidate set passes through untouched', async () => {
    for (let n = 0; n <= 6; n++) {
      const candidates = Array.from({ length: n }, (_, i) => m('messages', i));
      const out = await OPENAI.prepareRequest(req, candidates, ctx());
      expect(out.request).toBe(req);
      expect(out.markersApplied).toEqual([]);
    }
  });
});

// ─── 5. Security ──────────────────────────────────────────────────

describe('AutomaticCacheStrategy — security: extractMetrics is honest about WHY', () => {
  it('reportsUsage: false → NOT-APPLICABLE, naming the declaration', () => {
    for (const usage of [undefined, { input: 100, output: 1, cacheRead: 50 }]) {
      const c = OPENAI.extractMetrics(usage);
      expect(c.kind).toBe('not-applicable');
      expect(c.kind === 'not-applicable' && c.evidence).toMatch(/the OpenAI adapter/);
      expect(c.kind === 'not-applicable' && c.evidence).toMatch(/reportsUsage: false/);
    }
  });

  it('a provider that declares nothing → NOT-APPLICABLE, saying so', () => {
    const c = new NoOpCacheStrategy().extractMetrics({ input: 1, output: 1 });
    expect(c.kind === 'not-applicable' && c.evidence).toMatch(/declares no prompt caching/);
  });
});

// ─── 6. Performance ───────────────────────────────────────────────

describe('AutomaticCacheStrategy — performance', () => {
  it('prepareRequest stays flat', { timeout: 30_000, retry: 2 }, async () => {
    const run = async (times: number): Promise<void> => {
      for (let i = 0; i < times; i++) await OPENAI.prepareRequest(req, [m('system', 0)], ctx());
    };
    await expectScalesLinearly({
      small: () => run(1_000),
      large: () => run(10_000),
      scale: 10,
      why: 'a pass-through must not grow with the call count',
    });
  });
});

// ─── 7. ROI ───────────────────────────────────────────────────────

describe('AutomaticCacheStrategy — ROI', () => {
  it('an automatic adapter that DOES report usage is metered — known / unknown, never zero', () => {
    const reporting = new AutomaticCacheStrategy({ mode: 'automatic', reportsUsage: true });
    const hit = reporting.extractMetrics({ input: 200, output: 5, cacheRead: 1800 });
    expect(hit.kind).toBe('known');
    expect(hit.kind === 'known' && hit.value.cacheReadTokens).toBe(1800);
    expect(reporting.extractMetrics({ input: 200, output: 5 }).kind).toBe('unknown');
  });
});
