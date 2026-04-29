/**
 * fallbackProvider — unit tests.
 */

import { describe, expect, it, vi } from 'vitest';

import { fallbackProvider } from '../../../src/resilience/fallbackProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

const req = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  model: 'mock',
};

const ok = (tag: string): LLMResponse => ({
  content: tag,
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
});

const stub = (tag: string, mode: 'ok' | 'fail' = 'ok'): LLMProvider => ({
  name: tag,
  complete: async () => {
    if (mode === 'fail') throw new Error(`${tag} failed`);
    return ok(tag);
  },
});

describe('fallbackProvider', () => {
  it('returns first provider on success', async () => {
    const p = fallbackProvider(stub('A'), stub('B'), stub('C'));
    expect((await p.complete(req)).content).toBe('A');
  });

  it('advances to second on first failure', async () => {
    const p = fallbackProvider(stub('A', 'fail'), stub('B'), stub('C'));
    expect((await p.complete(req)).content).toBe('B');
  });

  it('advances through the full chain', async () => {
    const p = fallbackProvider(stub('A', 'fail'), stub('B', 'fail'), stub('C'));
    expect((await p.complete(req)).content).toBe('C');
  });

  it('throws the last error if every provider fails', async () => {
    const p = fallbackProvider(stub('A', 'fail'), stub('B', 'fail'), stub('C', 'fail'));
    await expect(p.complete(req)).rejects.toThrow('C failed');
  });

  it('throws synchronously if no providers given', () => {
    expect(() => fallbackProvider()).toThrow(/at least one provider/);
  });

  it('returns the single provider unchanged when given one', () => {
    const single = stub('only');
    const p = fallbackProvider(single);
    expect(p).toBe(single);
  });

  it('accepts options + providers via the options-first overload', async () => {
    const onFallback = vi.fn();
    const p = fallbackProvider({ onFallback, name: 'chain' }, stub('A', 'fail'), stub('B'));

    expect(p.name).toBe('chain');
    expect((await p.complete(req)).content).toBe('B');
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});
