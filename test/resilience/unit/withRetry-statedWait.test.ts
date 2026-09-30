/**
 * withRetry honours a STATED wait.
 *
 * The bug: the decorator backed off by its own schedule (200 ms, 400 ms, …)
 * even when the failure said how long to wait. A field app kept a wrapper for
 * exactly this — a gateway answered "Try again in 4 seconds" and four short
 * attempts ran out inside those 4 s. Now an error may declare `retryAfterMs`
 * (or `retryAfterSeconds`), read through ONE helper (statedWait.ts), and the
 * wait is max(schedule, stated), capped by `maxDelayMs`.
 *
 * Test types (Convention 3): unit (the wait chosen) · boundary (the cap, a
 * stated wait shorter than the schedule, garbled values) · contract (abort
 * still wins during the wait; no stated wait = byte-identical events) ·
 * scenario (the in-run `agentfootprint.error.retried` event carries it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withRetry } from '../../../src/resilience/withRetry.js';
import { statedRetryAfterMs } from '../../../src/resilience/statedWait.js';
import type {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ResilienceReport,
} from '../../../src/adapters/types.js';
import { Agent } from '../../../src/index.js';
import type { ErrorRetriedPayload } from '../../../src/events/payloads.js';

const REQ: LLMRequest = { messages: [{ role: 'user', content: 'hi' }], model: 'm' };
const OK: LLMResponse = {
  content: 'ok',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};

const throttled = (fields: Record<string, unknown>): Error =>
  Object.assign(new Error('429 rate limited'), { status: 429, ...fields });

function failingThen(errors: Error[]): { provider: LLMProvider; calls: () => number } {
  let n = 0;
  return {
    provider: {
      name: 'p',
      complete: async () => {
        const e = errors[n++];
        if (e) throw e;
        return OK;
      },
    },
    calls: () => n,
  };
}

/** Run a retrying complete() under fake timers; returns the waits it chose. */
async function waitsFor(
  err: Error,
  options: Parameters<typeof withRetry>[1] = {},
): Promise<{ waits: number[]; reports: ResilienceReport[] }> {
  vi.useFakeTimers();
  const waits: number[] = [];
  const reports: ResilienceReport[] = [];
  const { provider } = failingThen([err]);
  const wrapped = withRetry(provider, { ...options, onRetry: (_e, _a, ms) => waits.push(ms) });
  const done = wrapped.complete(REQ, { onResilience: (r) => reports.push(r) });
  await vi.runAllTimersAsync();
  await done;
  return { waits, reports };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('statedRetryAfterMs — the one reader', () => {
  it('reads retryAfterMs, else retryAfterSeconds', () => {
    expect(statedRetryAfterMs({ retryAfterMs: 1200 })).toBe(1200);
    expect(statedRetryAfterMs({ retryAfterSeconds: 4 })).toBe(4000);
    expect(statedRetryAfterMs({ retryAfterMs: 50, retryAfterSeconds: 9 })).toBe(50);
  });

  it('treats a garbled or missing value as absent — never a guess', () => {
    for (const bad of [NaN, -1, Infinity, '4', null]) {
      expect(statedRetryAfterMs({ retryAfterMs: bad })).toBeUndefined();
    }
    expect(statedRetryAfterMs(new Error('x'))).toBeUndefined();
    expect(statedRetryAfterMs(undefined)).toBeUndefined();
    expect(statedRetryAfterMs('429')).toBeUndefined();
  });
});

describe('withRetry — the wait chosen', () => {
  it('honours a stated wait longer than the schedule', async () => {
    const { waits, reports } = await waitsFor(throttled({ retryAfterMs: 4000 }));
    expect(waits).toEqual([4000]);
    expect(reports[0]).toMatchObject({ kind: 'retried', backoffMs: 4000, statedWaitMs: 4000 });
  });

  it('reads retryAfterSeconds too (errors built outside the library)', async () => {
    const { waits } = await waitsFor(throttled({ retryAfterSeconds: 2 }));
    expect(waits).toEqual([2000]);
  });

  it('keeps the schedule when the stated wait is shorter', async () => {
    const { waits, reports } = await waitsFor(throttled({ retryAfterMs: 50 }));
    expect(waits).toEqual([200]);
    expect(reports[0]).toMatchObject({ backoffMs: 200, statedWaitMs: 50 });
  });

  it('caps a stated wait at maxDelayMs — a hostile header cannot stall the run', async () => {
    const { waits, reports } = await waitsFor(throttled({ retryAfterMs: 3_600_000 }));
    expect(waits).toEqual([10_000]);
    expect(reports[0]).toMatchObject({ backoffMs: 10_000, statedWaitMs: 3_600_000 });

    const raised = await waitsFor(throttled({ retryAfterMs: 30_000 }), { maxDelayMs: 60_000 });
    expect(raised.waits).toEqual([30_000]);
  });

  it('actually sleeps the stated wait — not a moment less', async () => {
    vi.useFakeTimers();
    const { provider, calls } = failingThen([throttled({ retryAfterMs: 4000 })]);
    const done = withRetry(provider).complete(REQ);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    await expect(done).resolves.toBe(OK);
  });

  it('abort during a stated wait still wins', async () => {
    vi.useFakeTimers();
    const { provider, calls } = failingThen([throttled({ retryAfterMs: 5000 })]);
    const controller = new AbortController();
    const done = withRetry(provider).complete({ ...REQ, signal: controller.signal });
    const settled = done.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort(new Error('caller stopped'));
    expect(((await settled) as Error).message).toBe('caller stopped');
    expect(calls()).toBe(1);
  });

  it('the stream door honours it too (before the first chunk)', async () => {
    vi.useFakeTimers();
    let n = 0;
    const provider: LLMProvider = {
      name: 's',
      complete: async () => OK,
      async *stream(): AsyncIterable<LLMChunk> {
        if (n++ === 0) throw throttled({ retryAfterMs: 3000 });
        yield { tokenIndex: 0, content: '', done: true, response: OK };
      },
    };
    const waits: number[] = [];
    const wrapped = withRetry(provider, { onRetry: (_e, _a, ms) => waits.push(ms) });
    const drain = (async () => {
      for await (const _ of wrapped.stream!(REQ)) void _;
    })();
    await vi.runAllTimersAsync();
    await drain;
    expect(waits).toEqual([3000]);
  });
});

describe('withRetry — no stated wait is byte-identical', () => {
  it('the retried report has exactly the pre-change keys', async () => {
    const { waits, reports } = await waitsFor(Object.assign(new Error('boom'), { status: 503 }));
    expect(waits).toEqual([200]);
    expect(reports[0]).toStrictEqual({
      kind: 'retried',
      attempt: 2,
      maxAttempts: 3,
      lastError: 'boom',
      backoffMs: 200,
      reason: 'http-5xx',
    });
  });
});

describe('in a run — agentfootprint.error.retried carries statedWaitMs', () => {
  it('the event says what was asked and what was done', async () => {
    let n = 0;
    const provider = withRetry(
      {
        name: 'p',
        complete: async () => {
          if (n++ === 0) throw throttled({ retryAfterMs: 5 });
          return { ...OK, content: 'done' };
        },
      },
      { initialDelayMs: 1 },
    );
    const agent = Agent.create({ provider, model: 'm', maxIterations: 2 }).build();
    const seen: ErrorRetriedPayload[] = [];
    agent.on('agentfootprint.error.retried', (e) => seen.push(e.payload));
    await agent.run({ message: 'hi' });
    expect(seen).toStrictEqual([
      {
        attempt: 2,
        maxAttempts: 3,
        lastError: '429 rate limited',
        backoffMs: 5,
        reason: 'http-429',
        statedWaitMs: 5,
      },
    ]);
  });
});
