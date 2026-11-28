import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withRetry } from '../../../src/doors/resilience.js';
import { answer, failure, request, scriptedProvider, traceCall } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('defaults to three total attempts at 0, 200 and 600 ms', async () => {
  const trace = traceCall();
  const last = failure('last permitted attempt');
  const extra = answer('unexpected fourth call');
  const provider = withRetry(
    scriptedProvider('primary', trace, [failure('one'), failure('two'), last, extra]),
  );

  const rejected = expect(provider.complete(request)).rejects.toBe(last);
  await vi.runAllTimersAsync();
  await rejected;
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 200, 600]);
});

it.each([
  { maxAttempts: 0, times: [0] },
  { maxAttempts: -2, times: [0] },
  { maxAttempts: Number.NEGATIVE_INFINITY, times: [0] },
  { maxAttempts: 1.5, times: [0, 200] },
])(
  'retains the observed attempt count for maxAttempts=$maxAttempts',
  async ({ maxAttempts, times }) => {
    const trace = traceCall();
    const failures = [failure('first'), failure('second')];
    const provider = withRetry(scriptedProvider('primary', trace, [...failures, answer('extra')]), {
      maxAttempts,
    });

    const rejected = expect(provider.complete(request)).rejects.toBe(failures[times.length - 1]);
    await vi.runAllTimersAsync();
    await rejected;
    expect(trace.steps.map(({ at }) => at)).toEqual(times);
  },
);

it.each([
  { name: 'NaN', maxAttempts: Number.NaN },
  { name: 'positive Infinity', maxAttempts: Number.POSITIVE_INFINITY },
])('allows recovery beyond three attempts for maxAttempts=$name', async ({ maxAttempts }) => {
  const trace = traceCall();
  const reply = answer('recovered on five');
  const busy = failure('busy');
  const provider = withRetry(scriptedProvider('primary', trace, [busy, busy, busy, busy, reply]), {
    maxAttempts,
  });
  const onResilience = vi.fn();
  const settled = expect(provider.complete(request, { onResilience })).resolves.toBe(reply);

  await vi.runAllTimersAsync();
  await settled;
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 200, 600, 1400, 3000]);
  expect(onResilience.mock.calls.slice(0, 4).map(([event]) => event.maxAttempts)).toEqual(
    Array(4).fill(maxAttempts),
  );
});

it('doubles the default schedule and caps a scheduled wait at 10 seconds', async () => {
  const trace = traceCall();
  const busy = failure('busy');
  const reply = answer('recovered');
  const provider = withRetry(
    scriptedProvider('primary', trace, [...Array<Error>(7).fill(busy), reply]),
    {
      maxAttempts: 8,
    },
  );

  const settled = expect(provider.complete(request)).resolves.toBe(reply);
  await vi.runAllTimersAsync();
  await settled;
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 200, 600, 1400, 3000, 6200, 12600, 22600]);
});

it.each([
  { name: 'seconds', fields: { retryAfterSeconds: 1.25 }, asked: 1250, at: 1250 },
  {
    name: 'seconds after invalid milliseconds',
    fields: { retryAfterMs: Number.NaN, retryAfterSeconds: 0.2005 },
    asked: 200.5,
    at: 201,
  },
  {
    name: 'milliseconds preferred over seconds',
    fields: { retryAfterMs: 250, retryAfterSeconds: 2 },
    asked: 250,
    at: 250,
  },
  {
    name: 'stated wait capped by the default',
    fields: { retryAfterSeconds: 60 },
    asked: 10_000,
    at: 10_000,
  },
])(
  'honours $name with the original public delay and timer minimum',
  async ({ fields, asked, at }) => {
    const trace = traceCall();
    const busy = Object.assign(failure('rate limited', 429), fields);
    const reply = answer('recovered');
    const onRetry = vi.fn();
    const provider = withRetry(scriptedProvider('primary', trace, [busy, reply]), { onRetry });

    const settled = expect(provider.complete(request)).resolves.toBe(reply);
    await vi.runAllTimersAsync();
    await settled;
    expect(onRetry.mock.calls).toEqual([[busy, 2, asked]]);
    expect(trace.steps.map((entry) => entry.at)).toEqual([0, at]);
  },
);

it('waits at least one timer millisecond for a positive sub-millisecond delay', async () => {
  const trace = traceCall();
  const busy = failure('busy');
  const reply = answer('recovered');
  const onRetry = vi.fn();
  const provider = withRetry(scriptedProvider('primary', trace, [busy, reply]), {
    initialDelayMs: 0.25,
    onRetry,
  });

  const settled = expect(provider.complete(request)).resolves.toBe(reply);
  await vi.runAllTimersAsync();
  await settled;
  expect(onRetry.mock.calls).toEqual([[busy, 2, 0.25]]);
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 1]);
});

it.each([
  { name: 'AbortError', error: Object.assign(failure('abort-shaped'), { name: 'AbortError' }) },
  { name: 'retryable false', error: Object.assign(failure('server error'), { retryable: false }) },
  { name: 'HTTP 401', error: failure('unauthorized', 401) },
  {
    name: 'HTTP statusCode 499',
    error: Object.assign(new Error('client error'), { statusCode: 499 }),
  },
])('keeps $name ineligible under the default retry predicate', async ({ error }) => {
  const trace = traceCall();
  const provider = withRetry(
    scriptedProvider('primary', trace, [error, answer('unexpected retry')]),
  );

  const rejected = expect(provider.complete(request)).rejects.toBe(error);
  await vi.runAllTimersAsync();
  await rejected;
  expect(trace.requests).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('retries an unclassified provider failure under the default predicate', async () => {
  const trace = traceCall();
  const reply = answer('recovered');
  const provider = withRetry(
    scriptedProvider('primary', trace, [new Error('unclassified'), reply]),
  );

  const settled = expect(provider.complete(request)).resolves.toBe(reply);
  await vi.runAllTimersAsync();
  await settled;
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 200]);
});

it('calls a JavaScript retry predicate with the failed ordinal and accepts a truthy result', async () => {
  const trace = traceCall();
  const busy = failure('busy');
  const reply = answer('recovered');
  // JavaScript callers can return a value outside the TypeScript signature.
  const shouldRetry = vi.fn(() => 'yes' as unknown as boolean);
  const provider = withRetry(scriptedProvider('primary', trace, [busy, reply]), { shouldRetry });

  const settled = expect(provider.complete(request)).resolves.toBe(reply);
  await vi.runAllTimersAsync();
  await settled;
  expect(shouldRetry.mock.calls).toEqual([[busy, 1]]);
  expect(trace.steps.map(({ at }) => at)).toEqual([0, 200]);
});

it('propagates a thrown retry predicate error before recording or scheduling a retry', async () => {
  const trace = traceCall();
  const busy = failure('busy');
  const predicateFailure = new Error('predicate failed');
  const shouldRetry = vi.fn(() => {
    throw predicateFailure;
  });
  const onResilience = vi.fn();
  const provider = withRetry(scriptedProvider('primary', trace, [busy, answer('extra')]), {
    shouldRetry,
  });

  await expect(provider.complete(request, { onResilience })).rejects.toBe(predicateFailure);
  expect(shouldRetry.mock.calls).toEqual([[busy, 1]]);
  expect(onResilience).not.toHaveBeenCalled();
  expect(trace.requests).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
