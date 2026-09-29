/**
 * withRetry — stream() is retried BEFORE its first chunk, never after.
 *
 * The law (src/resilience/withRetry.ts · openStream): a stream that fails
 * before it has produced anything is re-opened under the same policy as
 * complete(); once the first chunk is in hand the rest is plain delegation,
 * so a mid-stream failure surfaces exactly as it did before.
 *
 *   • Unit        — pre-first-chunk failure retried then served; post-chunk
 *                   failure surfaces; non-retryable errors surface; a
 *                   synchronous throw from stream() itself is a pre-chunk
 *                   failure; reports on the hooks channel + onRetry.
 *   • Boundary    — abort during backoff; maxAttempts spent; empty stream.
 *   • Property    — every failure plan over 3 attempts × 4 positions: the
 *                   caller never sees a chunk twice, and no stream is opened
 *                   after one has yielded (exhaustive, not sampled).
 *   • Byte identity — a healthy stream hands the caller the SAME chunk
 *                   objects in the same order, reports nothing, and a
 *                   consumer break still closes the inner stream.
 */

import { describe, expect, it, vi } from 'vitest';

import { withRetry } from '../../../src/resilience/withRetry.js';
import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ResilienceReport,
} from '../../../src/adapters/types.js';

const request: LLMRequest = { messages: [{ role: 'user', content: 'hi' }], model: 'mock' };

const response: LLMResponse = {
  content: 'ab',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};

const chunks: readonly LLMChunk[] = [
  { tokenIndex: 0, content: 'a', done: false },
  { tokenIndex: 1, content: 'b', done: false },
  { tokenIndex: 2, content: '', done: true, response },
];

const httpError = (status: number): Error => Object.assign(new Error(`http ${status}`), { status });

/**
 * A scripted streaming provider. Each `stream()` call plays the next plan:
 * `null` streams every chunk; a number N throws a 503 after N chunks (0 =
 * before the first); an Error is thrown before the first chunk.
 */
function scripted(plans: (number | Error | null)[]): {
  provider: LLMProvider;
  opened: () => number;
  closed: () => number;
} {
  let opened = 0;
  let closed = 0;
  const provider: LLMProvider = {
    name: 'scripted',
    complete: async () => response,
    stream: async function* () {
      const plan = plans[Math.min(opened, plans.length - 1)] ?? null;
      opened += 1;
      try {
        if (plan instanceof Error) throw plan;
        for (let i = 0; i < chunks.length; i++) {
          if (plan === i) throw httpError(503);
          yield chunks[i]!;
        }
      } finally {
        closed += 1;
      }
    },
  };
  return { provider, opened: () => opened, closed: () => closed };
}

async function drain(stream: AsyncIterable<LLMChunk>): Promise<{
  got: LLMChunk[];
  error?: unknown;
}> {
  const got: LLMChunk[] = [];
  try {
    for await (const c of stream) got.push(c);
    return { got };
  } catch (error) {
    return { got, error };
  }
}

describe('withRetry · stream() — retried before the first chunk', () => {
  it('a 429 at connect is retried and the caller sees every chunk once', async () => {
    const s = scripted([httpError(429), null]);
    const onRetry = vi.fn();
    const reports: ResilienceReport[] = [];
    const wrapped = withRetry(s.provider, { initialDelayMs: 1, onRetry });

    const { got, error } = await drain(
      wrapped.stream!(request, { onResilience: (r) => reports.push(r) }),
    );

    expect(error).toBeUndefined();
    expect(got).toEqual(chunks);
    expect(s.opened()).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2, 1);
    expect(reports.map((r) => r.kind)).toEqual(['retried', 'recovered']);
    expect(reports[0]).toMatchObject({
      kind: 'retried',
      attempt: 2,
      maxAttempts: 3,
      backoffMs: 1,
      reason: 'http-429',
      lastError: 'http 429',
    });
    expect(reports[1]).toMatchObject({ kind: 'recovered', attempt: 2 });
  });

  it('a 5xx before the first chunk follows the same backoff as complete()', async () => {
    const s = scripted([0, 0, null]);
    const onRetry = vi.fn();
    const wrapped = withRetry(s.provider, { initialDelayMs: 2, backoffFactor: 3, onRetry });

    const { got } = await drain(wrapped.stream!(request));

    expect(got).toEqual(chunks);
    expect(s.opened()).toBe(3);
    expect(onRetry.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [2, 2],
      [3, 6],
    ]);
  });

  it('a synchronous throw from stream() itself is a pre-chunk failure', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'sync-throw',
      complete: async () => response,
      stream: (): AsyncIterable<LLMChunk> => {
        calls += 1;
        if (calls === 1) throw httpError(503);
        return (async function* () {
          yield* chunks;
        })();
      },
    };

    const { got, error } = await drain(withRetry(provider, { initialDelayMs: 1 }).stream!(request));

    expect(error).toBeUndefined();
    expect(got).toEqual(chunks);
    expect(calls).toBe(2);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const s = scripted([0]);
    const { got, error } = await drain(
      withRetry(s.provider, { maxAttempts: 2, initialDelayMs: 1 }).stream!(request),
    );

    expect(got).toEqual([]);
    expect(error).toMatchObject({ status: 503 });
    expect(s.opened()).toBe(2);
  });
});

describe('withRetry · stream() — never retried after the first chunk', () => {
  it('a failure after the first chunk surfaces and the stream is not re-opened', async () => {
    const s = scripted([1, null]);
    const reports: ResilienceReport[] = [];
    const onRetry = vi.fn();

    const { got, error } = await drain(
      withRetry(s.provider, { initialDelayMs: 1, onRetry }).stream!(request, {
        onResilience: (r) => reports.push(r),
      }),
    );

    expect(got).toEqual([chunks[0]]);
    expect(error).toMatchObject({ status: 503 });
    expect(s.opened()).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
  });

  it('a retried stream that then fails mid-stream is not retried again', async () => {
    const s = scripted([0, 2, null]);
    const { got, error } = await drain(
      withRetry(s.provider, { maxAttempts: 5, initialDelayMs: 1 }).stream!(request),
    );

    expect(got).toEqual([chunks[0], chunks[1]]);
    expect(error).toMatchObject({ status: 503 });
    expect(s.opened()).toBe(2);
  });

  it('property: over every failure plan the caller never sees a chunk twice (exhaustive)', async () => {
    // Positions 0..2 fail at that chunk index; 3 (null) streams clean.
    const positions: (number | null)[] = [0, 1, 2, null];
    for (const a of positions) {
      for (const b of positions) {
        for (const c of positions) {
          const s = scripted([a, b, c]);
          const { got, error } = await drain(
            withRetry(s.provider, { maxAttempts: 3, initialDelayMs: 0 }).stream!(request),
          );

          // What the caller saw is a prefix of ONE attempt — never a replay.
          expect(chunks.slice(0, got.length)).toEqual(got);
          // The attempt that yielded is the last one opened.
          const plans = [a, b, c];
          const firstYielding = plans.findIndex((p) => p !== 0);
          const expectedOpened = firstYielding === -1 ? 3 : firstYielding + 1;
          expect(s.opened()).toBe(expectedOpened);
          // It succeeded exactly when that attempt streamed clean.
          const served = firstYielding !== -1 && plans[firstYielding] === null;
          expect(error === undefined).toBe(served);
        }
      }
    }
  });
});

describe('withRetry · stream() — the policy decides, abort wins', () => {
  it('a non-retryable 400 surfaces on the first attempt', async () => {
    const s = scripted([httpError(400), null]);
    const onRetry = vi.fn();

    const { error } = await drain(
      withRetry(s.provider, { initialDelayMs: 1, onRetry }).stream!(request),
    );

    expect(error).toMatchObject({ status: 400 });
    expect(s.opened()).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('an AbortError from the stream is not retried', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const s = scripted([abort, null]);

    const { error } = await drain(withRetry(s.provider, { initialDelayMs: 1 }).stream!(request));

    expect(error).toBe(abort);
    expect(s.opened()).toBe(1);
  });

  it('a custom shouldRetry is asked with the error and attempt', async () => {
    const s = scripted([httpError(400), null]);
    const shouldRetry = vi.fn(() => true);

    const { got } = await drain(
      withRetry(s.provider, { initialDelayMs: 1, shouldRetry }).stream!(request),
    );

    expect(got).toEqual(chunks);
    expect(shouldRetry).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }), 1);
  });

  it('an abort during the backoff rejects with the signal reason and never re-opens', async () => {
    const s = scripted([0, null]);
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const wrapped = withRetry(s.provider, {
      initialDelayMs: 10_000,
      onRetry: () => setTimeout(() => controller.abort(reason), 5),
    });

    const started = Date.now();
    const { error } = await drain(wrapped.stream!({ ...request, signal: controller.signal }));

    expect(error).toBe(reason);
    expect(s.opened()).toBe(1);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('withRetry · stream() — byte identity for a healthy stream', () => {
  it('hands the caller the same chunk objects, in order, and reports nothing', async () => {
    const s = scripted([null]);
    const onRetry = vi.fn();
    const onResilience = vi.fn();

    const { got } = await drain(
      withRetry(s.provider, { onRetry }).stream!(request, { onResilience }),
    );

    expect(got).toHaveLength(chunks.length);
    got.forEach((c, i) => expect(c).toBe(chunks[i]));
    expect(s.opened()).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onResilience).not.toHaveBeenCalled();
  });

  it('an empty stream ends cleanly without a retry', async () => {
    let opened = 0;
    const provider: LLMProvider = {
      name: 'empty',
      complete: async () => response,
      // eslint-disable-next-line require-yield
      stream: async function* () {
        opened += 1;
      },
    };

    const { got, error } = await drain(withRetry(provider).stream!(request));

    expect(got).toEqual([]);
    expect(error).toBeUndefined();
    expect(opened).toBe(1);
  });

  it('a consumer that stops at the first chunk still closes the inner stream', async () => {
    const s = scripted([null]);
    for await (const _c of withRetry(s.provider).stream!(request)) break;
    expect(s.closed()).toBe(1);
  });

  it('a consumer that stops mid-stream still closes the inner stream', async () => {
    const s = scripted([null]);
    let n = 0;
    for await (const _c of withRetry(s.provider).stream!(request)) {
      if (++n === 2) break;
    }
    expect(s.closed()).toBe(1);
  });

  it('a provider without stream() still gets no stream()', () => {
    const provider: LLMProvider = { name: 'plain', complete: async () => response };
    expect(withRetry(provider).stream).toBeUndefined();
  });
});
