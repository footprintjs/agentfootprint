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
      {
        name: 'p',
        complete: async () => {
          throw new Error('primary down');
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    const result = await provider.complete(req);

    expect(result.content).toBe('fallback');
  });

  it('does not fall back on AbortError', async () => {
    const abortErr = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => {
          throw abortErr;
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    await expect(provider.complete(req)).rejects.toThrow('cancelled');
  });

  it('fires onFallback hook with the primary error', async () => {
    const onFallback = vi.fn();
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => {
          throw new Error('boom');
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
      { onFallback },
    );

    await provider.complete(req);

    expect(onFallback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('respects custom shouldFallback predicate', async () => {
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => {
          throw new Error('keep me');
        },
      },
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
        // eslint-disable-next-line require-yield
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

// ── v7.8 — resilience REPORTS through the per-call hooks channel ─────

describe('withFallback — resilience reports', () => {
  it('reports exactly one `fell-back` with honest pairwise names', async () => {
    const onResilience = vi.fn();
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => {
          throw new Error('primary down');
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    const result = await provider.complete(req, { onResilience });

    expect(result.content).toBe('fallback');
    expect(onResilience).toHaveBeenCalledTimes(1);
    expect(onResilience).toHaveBeenCalledWith({
      kind: 'fell-back',
      primary: 'p',
      fallback: 'f',
      reason: 'primary down',
    });
  });

  it('reports nothing when the primary succeeds', async () => {
    const onResilience = vi.fn();
    const provider = withFallback(
      { name: 'p', complete: async () => okResponse('primary') },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    await provider.complete(req, { onResilience });

    expect(onResilience).not.toHaveBeenCalled();
  });

  it('reports nothing when an AbortError skips the fallback', async () => {
    const onResilience = vi.fn();
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => {
          throw abort;
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    await expect(provider.complete(req, { onResilience })).rejects.toThrow('cancelled');
    expect(onResilience).not.toHaveBeenCalled();
  });

  it('reports `fell-back` when the primary stream fails before any chunk', async () => {
    const onResilience = vi.fn();
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => okResponse('primary'),
        // eslint-disable-next-line require-yield
        stream: async function* () {
          throw new Error('stream died');
        },
      },
      {
        name: 'f',
        complete: async () => okResponse('fallback'),
        stream: async function* () {
          yield { tokenIndex: 0, content: 'from-f', done: false };
          yield { tokenIndex: 1, content: '', done: true, response: okResponse('fallback') };
        },
      },
    );

    const chunks: string[] = [];
    for await (const c of provider.stream!(req, { onResilience })) chunks.push(c.content);

    expect(chunks).toEqual(['from-f', '']);
    expect(onResilience).toHaveBeenCalledTimes(1);
    expect(onResilience.mock.calls[0][0]).toMatchObject({
      kind: 'fell-back',
      primary: 'p',
      fallback: 'f',
      reason: 'stream died',
    });
  });

  it('reports NOTHING when the primary stream fails AFTER yielding a chunk', async () => {
    // The stream is committed — no fallback happens, so no report.
    const onResilience = vi.fn();
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => okResponse('primary'),
        stream: async function* () {
          yield { tokenIndex: 0, content: 'partial', done: false };
          throw new Error('mid-stream failure');
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    const chunks: string[] = [];
    await expect(
      (async () => {
        for await (const c of provider.stream!(req, { onResilience })) chunks.push(c.content);
      })(),
    ).rejects.toThrow('mid-stream failure');

    expect(chunks).toEqual(['partial']);
    expect(onResilience).not.toHaveBeenCalled();
  });

  it('reports NOTHING on the no-primary-stream branch', async () => {
    // Nothing failed — the primary simply has no stream(). Calling that a
    // fallback would be a lie.
    const onResilience = vi.fn();
    const provider = withFallback(
      { name: 'p', complete: async () => okResponse('primary') },
      {
        name: 'f',
        complete: async () => okResponse('fallback'),
        stream: async function* () {
          yield { tokenIndex: 0, content: '', done: true, response: okResponse('fallback') };
        },
      },
    );

    for await (const _c of provider.stream!(req, { onResilience })) {
      // drain
    }

    expect(onResilience).not.toHaveBeenCalled();
  });

  it('forwards hooks into completeAsStream for a complete-only fallback', async () => {
    const onResilience = vi.fn();
    const seen: unknown[] = [];
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => okResponse('primary'),
        // eslint-disable-next-line require-yield
        stream: async function* () {
          throw new Error('stream died');
        },
      },
      {
        name: 'f',
        complete: async (_r, hooks) => {
          seen.push(hooks);
          return okResponse('fallback');
        },
      },
    );

    for await (const _c of provider.stream!(req, { onResilience })) {
      // drain
    }

    // The fallback's complete() received the SAME hooks object, so a
    // decorator nested inside it can still report.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveProperty('onResilience');
  });

  it('behaves identically with no hooks argument', async () => {
    const provider = withFallback(
      {
        name: 'p',
        complete: async () => {
          throw new Error('primary down');
        },
      },
      { name: 'f', complete: async () => okResponse('fallback') },
    );

    await expect(provider.complete(req)).resolves.toMatchObject({ content: 'fallback' });
  });
});
