/**
 * withRetry — unit tests.
 *
 * Verifies retry policy: backoff, predicate gating, abort propagation,
 * and stream pass-through (no retry on streams by design).
 */

import { describe, expect, it, vi } from 'vitest';

import { withRetry } from '../../../src/resilience/withRetry.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

const noopRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'mock',
};

const successResponse: LLMResponse = {
  content: 'ok',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};

function makeFlakyProvider(plan: ('ok' | Error)[]): {
  provider: LLMProvider;
  callCount: () => number;
} {
  let i = 0;
  const provider: LLMProvider = {
    name: 'flaky',
    complete: async () => {
      const step = plan[i++];
      if (step instanceof Error) throw step;
      return successResponse;
    },
  };
  return { provider, callCount: () => i };
}

describe('withRetry', () => {
  it('returns the first successful response without retry', async () => {
    const { provider, callCount } = makeFlakyProvider(['ok']);
    const wrapped = withRetry(provider);

    const result = await wrapped.complete(noopRequest);

    expect(result.content).toBe('ok');
    expect(callCount()).toBe(1);
  });

  it('retries until success within maxAttempts', async () => {
    const { provider, callCount } = makeFlakyProvider([
      new Error('boom1'),
      new Error('boom2'),
      'ok',
    ]);
    const wrapped = withRetry(provider, { initialDelayMs: 1, maxAttempts: 3 });

    const result = await wrapped.complete(noopRequest);

    expect(result.content).toBe('ok');
    expect(callCount()).toBe(3);
  });

  it('throws the last error after exhausting maxAttempts', async () => {
    const { provider, callCount } = makeFlakyProvider([
      new Error('boom1'),
      new Error('boom2'),
      new Error('boom3'),
    ]);
    const wrapped = withRetry(provider, { initialDelayMs: 1, maxAttempts: 3 });

    await expect(wrapped.complete(noopRequest)).rejects.toThrow('boom3');
    expect(callCount()).toBe(3);
  });

  it('skips retry for 4xx errors (except 429)', async () => {
    const error400 = Object.assign(new Error('bad request'), { status: 400 });
    const { provider, callCount } = makeFlakyProvider([error400, 'ok']);
    const wrapped = withRetry(provider, { initialDelayMs: 1 });

    await expect(wrapped.complete(noopRequest)).rejects.toThrow('bad request');
    expect(callCount()).toBe(1); // didn't retry
  });

  it('does retry on 429 Too Many Requests', async () => {
    const error429 = Object.assign(new Error('rate limited'), { status: 429 });
    const { provider, callCount } = makeFlakyProvider([error429, 'ok']);
    const wrapped = withRetry(provider, { initialDelayMs: 1 });

    const result = await wrapped.complete(noopRequest);

    expect(result.content).toBe('ok');
    expect(callCount()).toBe(2);
  });

  it('skips retry on AbortError', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { provider, callCount } = makeFlakyProvider([abortErr, 'ok']);
    const wrapped = withRetry(provider, { initialDelayMs: 1 });

    await expect(wrapped.complete(noopRequest)).rejects.toThrow('aborted');
    expect(callCount()).toBe(1);
  });

  it('invokes onRetry hook with attempt number and delay', async () => {
    const { provider } = makeFlakyProvider([new Error('boom'), 'ok']);
    const onRetry = vi.fn();
    const wrapped = withRetry(provider, { initialDelayMs: 5, onRetry });

    await wrapped.complete(noopRequest);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 5);
  });

  it('passes stream() through without retry', async () => {
    const inner: LLMProvider = {
      name: 'streamy',
      complete: async () => successResponse,
      stream: async function* () {
        yield { tokenIndex: 0, content: 'x', done: false };
        yield { tokenIndex: 1, content: '', done: true, response: successResponse };
      },
    };
    const wrapped = withRetry(inner);

    expect(wrapped.stream).toBeDefined();
    const chunks: string[] = [];
    for await (const c of wrapped.stream!(noopRequest)) {
      chunks.push(c.content);
    }
    expect(chunks).toEqual(['x', '']);
  });
});
