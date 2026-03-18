/**
 * Unit tests for resilientProvider — fallback + circuit breaker combined.
 */

import { describe, it, expect, vi } from 'vitest';
import { resilientProvider } from '../../src/adapters/resilientProvider';
import type { LLMProvider, LLMResponse } from '../../src/types/llm';

function makeProvider(name: string): LLMProvider {
  return {
    chat: async () => ({ content: `from ${name}`, model: name, finishReason: 'stop' as const }),
  };
}

function makeFailingProvider(name: string): LLMProvider {
  return { chat: async () => { throw new Error(`${name} failed`); } };
}

describe('resilientProvider: basic fallback', () => {
  it('uses first provider when healthy', async () => {
    const p = resilientProvider([makeProvider('p1'), makeProvider('p2')]);
    const result = await p.chat([]);
    expect(result.model).toBe('p1');
  });

  it('falls back on failure', async () => {
    const p = resilientProvider([makeFailingProvider('p1'), makeProvider('p2')]);
    const result = await p.chat([]);
    expect(result.model).toBe('p2');
  });
});

describe('resilientProvider: circuit breaker integration', () => {
  it('trips breaker after threshold failures', async () => {
    const p = resilientProvider(
      [makeFailingProvider('p1'), makeProvider('p2')],
      { circuitBreaker: { threshold: 2, resetAfterMs: 60_000 } },
    );

    // First 2 calls: p1 fails, falls back to p2
    await p.chat([]);
    await p.chat([]);

    // Breaker for p1 should be open now
    expect(p.breakers[0].getState()).toBe('open');
  });

  it('skips tripped providers instantly (no wasted latency)', async () => {
    const timeline: string[] = [];

    const slowFailingP1: LLMProvider = {
      chat: async () => {
        timeline.push('p1-attempt');
        throw new Error('fail');
      },
    };
    const p2: LLMProvider = {
      chat: async () => {
        timeline.push('p2-attempt');
        return { content: 'ok', model: 'p2', finishReason: 'stop' as const };
      },
    };

    const p = resilientProvider(
      [slowFailingP1, p2],
      { circuitBreaker: { threshold: 1, resetAfterMs: 60_000 } },
    );

    // First call: p1 fails → falls back to p2 → breaker trips
    await p.chat([]);
    expect(timeline).toEqual(['p1-attempt', 'p2-attempt']);

    // Second call: p1 skipped (breaker open) → goes straight to p2
    timeline.length = 0;
    await p.chat([]);
    expect(timeline).toEqual(['p2-attempt']); // p1 never attempted!
  });

  it('exposes breaker state for each provider', () => {
    const p = resilientProvider(
      [makeProvider('p1'), makeProvider('p2'), makeProvider('p3')],
    );

    expect(p.breakers).toHaveLength(3);
    expect(p.breakers[0].getState()).toBe('closed');
    expect(p.breakers[1].getState()).toBe('closed');
    expect(p.breakers[2].getState()).toBe('closed');
  });

  it('resets breaker on success', async () => {
    const callCount = { p1: 0 };
    const flakyP1: LLMProvider = {
      chat: async () => {
        callCount.p1++;
        if (callCount.p1 <= 2) throw new Error('fail');
        return { content: 'ok', model: 'p1', finishReason: 'stop' as const };
      },
    };

    const p = resilientProvider(
      [flakyP1, makeProvider('p2')],
      { circuitBreaker: { threshold: 3, resetAfterMs: 60_000 } },
    );

    // Fail twice, then manual reset + succeed
    await p.chat([]); // p1 fails → p2
    await p.chat([]); // p1 fails → p2

    expect(p.breakers[0].getState()).toBe('closed'); // not yet tripped (threshold=3)

    // Force p1 to succeed next time
    await p.chat([]); // p1 succeeds!
    expect(p.breakers[0].getState()).toBe('closed');
  });
});

describe('resilientProvider: onFallback callback', () => {
  it('fires for circuit breaker skips too', async () => {
    const events: number[] = [];

    const p = resilientProvider(
      [makeFailingProvider('p1'), makeProvider('p2')],
      {
        circuitBreaker: { threshold: 1, resetAfterMs: 60_000 },
        onFallback: (from, to) => events.push(to),
      },
    );

    // First call: real failure
    await p.chat([]);
    expect(events).toEqual([1]);

    // Second call: circuit breaker skip
    events.length = 0;
    await p.chat([]);
    expect(events).toEqual([1]); // Still notified about the skip
  });
});

describe('resilientProvider: all providers down', () => {
  it('throws when all providers fail', async () => {
    const p = resilientProvider([makeFailingProvider('p1'), makeFailingProvider('p2')]);
    await expect(p.chat([])).rejects.toThrow('p2 failed');
  });

  it('throws when all breakers are open', async () => {
    const p = resilientProvider(
      [makeFailingProvider('p1'), makeFailingProvider('p2')],
      { circuitBreaker: { threshold: 1, resetAfterMs: 60_000 } },
    );

    // Trip both breakers
    await expect(p.chat([])).rejects.toThrow(); // p1 fails → p2 fails
    // Now both open
    await expect(p.chat([])).rejects.toThrow('All providers failed');
  });
});
