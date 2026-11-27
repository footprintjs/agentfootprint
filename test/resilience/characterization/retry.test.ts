import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withRetry } from '../../../src/doors/resilience.js';
import {
  answer,
  chunk,
  drain,
  failure,
  request,
  scriptedProvider,
  terminal,
  traceCall,
} from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const waitCases = [
  { stated: undefined, wait: 8 },
  { stated: Number.NaN, wait: 8 },
  { stated: -1, wait: 8 },
  { stated: 0, wait: 8 },
  { stated: 2, wait: 8 },
  { stated: 8, wait: 8 },
  { stated: 13, wait: 13 },
  { stated: 100, wait: 20 },
];

it.each(waitCases)(
  'pins retry admission, callback order and the $wait ms wait (stated=$stated)',
  async ({ stated, wait }) => {
    const trace = traceCall();
    const unavailable = failure('back soon', 503, stated);
    const reply = answer('recovered');
    const provider = withRetry(scriptedProvider('primary', trace, [unavailable, reply]), {
      initialDelayMs: 8,
      maxDelayMs: 20,
      maxAttempts: 2,
      shouldRetry(error, attempt) {
        expect(error).toBe(unavailable);
        trace.mark(`predicate:${attempt}`);
        return true;
      },
      onRetry(error, attempt, delay) {
        expect(error).toBe(unavailable);
        trace.mark(`callback:${attempt}:${delay}`);
      },
    });
    const running = provider.complete(request, {
      onResilience(event) {
        if (event.kind === 'retried') trace.mark(`retried:${event.attempt}:${event.backoffMs}`);
        if (event.kind === 'recovered')
          trace.mark(`recovered:${event.attempt}:${event.totalDurationMs}`);
      },
    });
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(trace.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toBe(reply);
    expect(trace.steps).toEqual([
      { at: 0, action: 'primary.complete' },
      { at: 0, action: 'predicate:1' },
      { at: 0, action: `callback:2:${wait}` },
      { at: 0, action: `retried:2:${wait}` },
      { at: wait, action: 'primary.complete' },
      { at: wait, action: `recovered:2:${wait}` },
    ]);
    expect(trace.requests.map(({ bytes }) => bytes)).toEqual([
      JSON.stringify(request),
      JSON.stringify(request),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('keeps the final rejection by identity and leaves the predicate untouched after exhaustion', async () => {
  const first = failure('first');
  const last = failure('last');
  const trace = traceCall();
  const evaluate = vi.fn(() => true);
  const provider = withRetry(scriptedProvider('primary', trace, [first, last]), {
    initialDelayMs: 3,
    maxAttempts: 2,
    shouldRetry: evaluate,
  });
  const rejected = expect(provider.complete(request)).rejects.toBe(last);
  await vi.advanceTimersByTimeAsync(3);
  await rejected;
  expect(evaluate.mock.calls).toEqual([[first, 1]]);
  expect(trace.steps).toEqual([
    { at: 0, action: 'primary.complete' },
    { at: 3, action: 'primary.complete' },
  ]);
});

it('preserves caller cancellation by identity and releases the actual backoff timer', async () => {
  const controller = new AbortController();
  const reason = new Error('caller left');
  const trace = traceCall();
  const provider = withRetry(
    scriptedProvider('primary', trace, [failure('wait'), answer('never sent')]),
    {
      initialDelayMs: 15,
    },
  );
  const rejected = expect(
    provider.complete({ ...request, signal: controller.signal }),
  ).rejects.toBe(reason);
  await vi.advanceTimersByTimeAsync(7);
  expect(vi.getTimerCount()).toBe(1);
  controller.abort(reason);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(30);
  expect(trace.steps).toEqual([{ at: 0, action: 'primary.complete' }]);
});

it.each([
  { title: 'opening throws synchronously', first: failure('opening') },
  { title: 'first iterator step fails', first: [failure('first step')] },
])(
  'retries when $title and reports recovery before exposing even an empty chunk',
  async ({ first }) => {
    const trace = traceCall();
    const chunks = [chunk(''), chunk('served', 1), terminal(answer('served'), 2)];
    const provider = withRetry(scriptedProvider('primary', trace, [], [first, chunks]), {
      initialDelayMs: 5,
    });
    const reading = drain(
      provider.stream!(request, {
        onResilience: (event) => trace.mark(event.kind),
      }),
      (chunk) => trace.mark(`yield:${chunk.tokenIndex}`),
    );
    await vi.advanceTimersByTimeAsync(4);
    expect(trace.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await reading).toEqual(chunks);
    expect(trace.steps.filter(({ action }) => action !== 'primary.close')).toEqual([
      { at: 0, action: 'primary.stream' },
      { at: 0, action: 'retried' },
      { at: 5, action: 'primary.stream' },
      { at: 5, action: 'recovered' },
      { at: 5, action: 'yield:0' },
      { at: 5, action: 'yield:1' },
      { at: 5, action: 'yield:2' },
    ]);
  },
);

it.each(['before entry', 'in flight'] as const)(
  'a caller abort %s reaches the provider and skips the retry predicate',
  async (when) => {
    const trace = traceCall();
    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    const shouldRetry = vi.fn(() => true);
    const provider = withRetry(
      scriptedProvider('primary', trace, [
        async ({ signal }) => {
          expect(signal).toBe(controller.signal);
          signal?.throwIfAborted();
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      ]),
      { shouldRetry },
    );
    if (when === 'before entry') controller.abort(reason);
    const rejected = expect(
      provider.complete({ ...request, signal: controller.signal }),
    ).rejects.toBe(reason);
    if (when === 'in flight') controller.abort(reason);
    await rejected;
    expect(trace.steps).toEqual([{ at: 0, action: 'primary.complete' }]);
    expect(shouldRetry).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('returns a throwing retry callback to the caller before the resilience hook and timer', async () => {
  const trace = traceCall();
  const rejected = new Error('callback stopped the retry');
  const provider = withRetry(scriptedProvider('primary', trace, [failure('original')]), {
    onRetry() {
      trace.mark('callback');
      throw rejected;
    },
  });
  await expect(
    provider.complete(request, { onResilience: (event) => trace.mark(event.kind) }),
  ).rejects.toBe(rejected);
  expect(trace.steps).toEqual([
    { at: 0, action: 'primary.complete' },
    { at: 0, action: 'callback' },
  ]);
  expect(vi.getTimerCount()).toBe(0);
});
