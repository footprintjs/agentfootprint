import { describe, expect, it } from 'vitest';
import { cacheStrategyFor } from '../../src/cache/cacheStrategyFor.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';
import type { LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';
import { Agent } from '../../src/index.js';

const dynamic: LLMProvider = {
  name: 'model-aware',
  promptCaching: (model: string) =>
    model === 'supported'
      ? { mode: 'breakpoints', maxBreakpoints: 2, reportsUsage: true }
      : undefined,
  complete: async () => ({ content: 'ok', toolCalls: [], usage: { input: 1, output: 1 } }),
};

describe('model-aware prompt-cache declaration', () => {
  it('selects from the declared model function, including all three decorators', () => {
    for (const provider of [
      dynamic,
      withRetry(dynamic),
      withCircuitBreaker(dynamic),
      withFallback(dynamic, { name: 'no-cache', complete: dynamic.complete }),
    ]) {
      expect(cacheStrategyFor(provider, 'supported').name).toBe('breakpoints');
      expect(cacheStrategyFor(provider, 'unknown').name).toBe('none');
    }
    expect(cacheStrategyFor(dynamic).name).toBe('none');
  });

  it('fallback evaluates and strips markers for the actual model on each side', async () => {
    const requests: LLMRequest[] = [];
    const primary: LLMProvider = {
      ...dynamic,
      complete: async (req) => {
        requests.push(req);
        throw new Error('fixture');
      },
    };
    const fallback: LLMProvider = {
      name: 'uncached',
      complete: async (req) => {
        requests.push(req);
        return dynamic.complete(req);
      },
    };
    const pair = withFallback(primary, fallback);
    await pair.complete({
      model: 'unknown',
      messages: [],
      cacheMarkers: [{ field: 'system', boundaryIndex: 0, ttl: 'short', reason: 'fixture' }],
    });
    expect(requests.every((req) => !('cacheMarkers' in req))).toBe(true);
  });

  it('a runtime model override re-resolves the same capability before the request', async () => {
    const requests: LLMRequest[] = [];
    const provider: LLMProvider = {
      ...dynamic,
      complete: async (req) => {
        requests.push(req);
        return dynamic.complete(req);
      },
    };
    const agent = Agent.create({ provider, model: 'supported' })
      .system('stable')
      .configure(({ message }) => ({ model: message === 'off' ? 'unknown' : 'supported' }))
      .build();
    await agent.run({ message: 'off' });
    await agent.run({ message: 'on' });
    expect(requests[0].cacheMarkers).toBeUndefined();
    expect(requests[1].cacheMarkers?.length).toBeGreaterThan(0);
  });

  it('filters unsupported marker fields before the clamp and the receipt', async () => {
    const strategy = cacheStrategyFor({
      name: 'system-only',
      promptCaching: {
        mode: 'breakpoints',
        maxBreakpoints: 1,
        reportsUsage: true,
        fields: ['system'],
      },
    });
    const out = await strategy.prepareRequest(
      { model: 'm', messages: [] },
      [
        { field: 'tools', boundaryIndex: 0, ttl: 'short', reason: 'unsupported' },
        { field: 'system', boundaryIndex: 0, ttl: 'short', reason: 'supported' },
      ],
      { iteration: 1, iterationsRemaining: 2, recentHitRate: undefined, cachingDisabled: false },
    );
    expect(out.markersApplied.map((marker) => marker.reason)).toEqual(['supported']);
  });
});
