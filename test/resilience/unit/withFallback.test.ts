/**
 * withFallback — unit tests.
 */

import { describe, expect, it, vi } from 'vitest';

import { withFallback } from '../../../src/resilience/withFallback.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

const req = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  model: 'mock',
};

const okResponse = (tag: string): LLMResponse => ({
  content: tag,
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
});

describe('withFallback — complete()', () => {
  it('returns primary on success without calling fallback', async () => {
    const fallbackCall = vi.fn();
    const provider = withFallback(
      { name: 'p', complete: async () => okResponse('primary') },
      { name: 'f', complete: fallbackCall.mockResolvedValue(okResponse('fallback')) },
    );

    const result = await provider.complete(req);

    expect(result.content).toBe('primary');
    expect(fallbackCall).not.toHaveBeenCalled();
  });

  it('returns fallback on primary error', async () => {
    const provider = withFallback(
      { name: 'p', complete: async () => { throw new Error('primary down'); } },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    const result = await provider.complete(req);

    expect(result.content).toBe('fallback');
  });

  it('does not fall back on AbortError', async () => {
    const abortErr = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const provider = withFallback(
      { name: 'p', complete: async () => { throw abortErr; } },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    await expect(provider.complete(req)).rejects.toThrow('cancelled');
  });

  it('fires onFallback hook with the primary error', async () => {
    const onFallback = vi.fn();
    const provider = withFallback(
      { name: 'p', complete: async () => { throw new Error('boom'); } },
      { name: 'f', complete: async () => okResponse('fallback') },
      { onFallback },
    );

    await provider.complete(req);

    expect(onFallback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('respects custom shouldFallback predicate', async () => {
    const provider = withFallback(
      { name: 'p', complete: async () => { throw new Error('keep me'); } },
      { name: 'f', complete: async () => okResponse('fallback') },
      { shouldFallback: (err) => !(err as Error).message.includes('keep me') },
    );

    await expect(provider.complete(req)).rejects.toThrow('keep me');
  });
});

describe('withFallback — stream()', () => {
  it('yields primary chunks when stream succeeds', async () => {
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => okResponse('p'),
        stream: async function* () {
          yield { tokenIndex: 0, content: 'a', done: false };
          yield { tokenIndex: 1, content: '', done: true, response: okResponse('p') };
        },
      } as LLMProvider,
      {
        name: 'f',
        complete: async () => okResponse('f'),
      },
    );

    const chunks: string[] = [];
    for await (const c of provider.stream!(req)) chunks.push(c.content);
    expect(chunks).toEqual(['a', '']);
  });

  it('falls back when primary stream throws BEFORE first chunk', async () => {
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => okResponse('p'),
        stream: async function* () {
          throw new Error('stream init failed');
        },
      } as LLMProvider,
      {
        name: 'f',
        complete: async () => okResponse('fallback-content'),
      },
    );

    const chunks: { content: string; done: boolean }[] = [];
    for await (const c of provider.stream!(req)) {
      chunks.push({ content: c.content, done: c.done });
    }
    // Fallback has no stream() so it synthesizes one terminal chunk.
    expect(chunks).toEqual([{ content: '', done: true }]);
  });

  it('does NOT fall back if primary stream errors AFTER yielding chunks', async () => {
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => okResponse('p'),
        stream: async function* () {
          yield { tokenIndex: 0, content: 'partial', done: false };
          throw new Error('mid-stream failure');
        },
      } as LLMProvider,
      {
        name: 'f',
        complete: async () => okResponse('fallback'),
      },
    );

    const chunks: string[] = [];
    let caught: Error | undefined;
    try {
      for await (const c of provider.stream!(req)) chunks.push(c.content);
    } catch (err) {
      caught = err as Error;
    }
    expect(chunks).toEqual(['partial']);
    expect(caught?.message).toBe('mid-stream failure');
  });
});
