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

// ── v7.8 — resilience REPORTS through the per-call hooks channel ─────
//
// The decorator reports what it DID to whoever called it. In a run the
// caller is agentfootprint's LLM stage, which turns each report into an
// `agentfootprint.error.retried` / `error.recovered` event; standalone
// the caller passes nothing and every report site short-circuits.

describe('withRetry — resilience reports', () => {
  it('reports one `retried` per retry, then `recovered`, in order', async () => {
    const { provider } = makeFlakyProvider([new Error('boom-1'), new Error('boom-2'), 'ok']);
    const onResilience = vi.fn();
    const wrapped = withRetry(provider, { initialDelayMs: 200, backoffFactor: 2 });

    await wrapped.complete(noopRequest, { onResilience });

    expect(onResilience).toHaveBeenCalledTimes(3);
    expect(onResilience.mock.calls[0][0]).toEqual({
      kind: 'retried',
      attempt: 2,
      maxAttempts: 3,
      lastError: 'boom-1',
      backoffMs: 200,
      reason: 'no-status',
    });
    expect(onResilience.mock.calls[1][0]).toEqual({
      kind: 'retried',
      attempt: 3,
      maxAttempts: 3,
      lastError: 'boom-2',
      backoffMs: 400,
      reason: 'no-status',
    });
    const recovered = onResilience.mock.calls[2][0];
    expect(recovered.kind).toBe('recovered');
    expect(recovered.attempt).toBe(3);
    // 200ms + 400ms of real backoff elapsed before the success.
    expect(recovered.totalDurationMs).toBeGreaterThanOrEqual(600);
  });

  it('reports NOTHING when the first attempt succeeds (zero noise)', async () => {
    const { provider } = makeFlakyProvider(['ok']);
    const onResilience = vi.fn();
    const wrapped = withRetry(provider);

    await wrapped.complete(noopRequest, { onResilience });

    expect(onResilience).not.toHaveBeenCalled();
  });

  it('classifies the retry reason from the error status', async () => {
    const cases: readonly [number | undefined, string][] = [
      [429, 'http-429'],
      [503, 'http-5xx'],
    ];
    for (const [status, expected] of cases) {
      const err = Object.assign(new Error('rate limited'), { status });
      const { provider } = makeFlakyProvider([err, 'ok']);
      const onResilience = vi.fn();
      await withRetry(provider, { initialDelayMs: 1 }).complete(noopRequest, { onResilience });
      expect(onResilience.mock.calls[0][0].reason).toBe(expected);
    }
  });

  it("classifies a custom-predicate 4xx retry as 'http-4xx'", async () => {
    // Only reachable via a custom predicate — the default rejects
    // non-429 4xx. Pins the documented derivation.
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const { provider } = makeFlakyProvider([err, 'ok']);
    const onResilience = vi.fn();

    await withRetry(provider, { initialDelayMs: 1, shouldRetry: () => true }).complete(
      noopRequest,
      {
        onResilience,
      },
    );

    expect(onResilience.mock.calls[0][0].reason).toBe('http-4xx');
  });

  it('reports every retry but NO `recovered` when attempts are exhausted', async () => {
    // The whole reason reports ride a callback and not the response: an
    // exhausted retry THROWS, so there is no LLMResponse to carry them.
    const { provider } = makeFlakyProvider([
      new Error('boom-1'),
      new Error('boom-2'),
      new Error('final'),
    ]);
    const onResilience = vi.fn();
    const wrapped = withRetry(provider, { maxAttempts: 3, initialDelayMs: 1 });

    await expect(wrapped.complete(noopRequest, { onResilience })).rejects.toThrow('final');

    const kinds = onResilience.mock.calls.map((c) => c[0].kind);
    expect(kinds).toEqual(['retried', 'retried']);
    expect(kinds).not.toContain('recovered');
  });

  it('behaves identically with no hooks argument at all', async () => {
    const { provider, callCount } = makeFlakyProvider([new Error('boom'), 'ok']);
    const wrapped = withRetry(provider, { initialDelayMs: 1 });

    // No second argument — the report sites must short-circuit, not throw.
    const res = await wrapped.complete(noopRequest);

    expect(res.content).toBe('ok');
    expect(callCount()).toBe(2);
  });

  it('tolerates a hooks object with no onResilience', async () => {
    const { provider } = makeFlakyProvider([new Error('boom'), 'ok']);
    const wrapped = withRetry(provider, { initialDelayMs: 1 });

    await expect(wrapped.complete(noopRequest, {})).resolves.toMatchObject({ content: 'ok' });
  });

  it('forwards hooks through the stream() pass-through', async () => {
    // Load-bearing: withRetry rebuilds a fresh provider object, so an
    // inner decorator's reports vanish unless stream() forwards.
    const seen: unknown[] = [];
    const inner: LLMProvider = {
      name: 'streamy',
      complete: async () => successResponse,
      stream: async function* (_req, hooks) {
        seen.push(hooks);
        yield { tokenIndex: 0, content: '', done: true, response: successResponse };
      },
    };
    const hooks = { onResilience: vi.fn() };

    for await (const _c of withRetry(inner).stream!(noopRequest, hooks)) {
      // drain
    }

    expect(seen).toEqual([hooks]);
  });
});
