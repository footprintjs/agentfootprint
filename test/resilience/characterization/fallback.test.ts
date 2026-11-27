import { expect, it, vi } from 'vitest';
import { withFallback, withRetry } from '../../../src/doors/resilience.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';
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

it.each([
  {
    outer: 'fallback',
    expected: [
      '0:primary.complete',
      '0:retry:2:4',
      '0:retried',
      '4:primary.complete',
      '4:onFallback:primary',
      '4:fell-back',
      '4:secondary.complete',
    ],
    chosen: 'secondary',
  },
  {
    outer: 'retry',
    expected: [
      '0:primary.complete',
      '0:onFallback:primary',
      '0:fell-back',
      '0:secondary.complete',
      '0:retry:2:4',
      '0:retried',
      '4:primary.complete',
      '4:recovered',
    ],
    chosen: 'primary',
  },
] as const)(
  'pins the selected provider and both callback channels with $outer outside',
  async ({ outer, expected, chosen }) => {
    vi.useFakeTimers();
    try {
      const trace = traceCall();
      const fromPrimary = answer('primary answer');
      const fromSecondary = answer('secondary answer');
      const primary = scriptedProvider('primary', trace, [
        failure('primary'),
        outer === 'retry' ? fromPrimary : failure('primary'),
      ]);
      const secondary = scriptedProvider('secondary', trace, [
        outer === 'retry' ? failure('secondary') : fromSecondary,
      ]);
      const retryOptions = {
        initialDelayMs: 4,
        maxAttempts: 2,
        onRetry: (_error: unknown, next: number, wait: number) =>
          trace.mark(`retry:${next}:${wait}`),
      };
      const fallbackOptions = {
        onFallback: (error: unknown) => trace.mark(`onFallback:${(error as Error).message}`),
      };
      const provider =
        outer === 'retry'
          ? withRetry(withFallback(primary, secondary, fallbackOptions), retryOptions)
          : withFallback(withRetry(primary, retryOptions), secondary, fallbackOptions);
      const running = provider.complete(request, {
        onResilience: (event) => trace.mark(event.kind),
      });
      await vi.advanceTimersByTimeAsync(4);
      expect(await running).toEqual(chosen === 'primary' ? fromPrimary : fromSecondary);
      expect(trace.steps.map(({ at, action }) => `${at}:${action}`)).toEqual(expected);
      expect(trace.requests.map(({ bytes }) => bytes)).toEqual(
        Array(3).fill(JSON.stringify(request)),
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it('uses a stream-capable secondary when the primary cannot stream, without reporting a failure', async () => {
  const trace = traceCall();
  const chunks = [chunk('secondary'), terminal(answer('secondary'), 1)];
  const provider = withFallback(
    scriptedProvider('primary', trace, []),
    scriptedProvider('secondary', trace, [], [chunks]),
    { onFallback: () => trace.mark('onFallback') },
  );
  expect(
    await drain(provider.stream!(request, { onResilience: (event) => trace.mark(event.kind) })),
  ).toEqual(chunks);
  expect(trace.steps.map(({ action }) => action)).toEqual(['secondary.stream', 'secondary.close']);
});

it('switches to a complete-only secondary after a synchronous primary opening failure', async () => {
  const trace = traceCall();
  const reply = answer('secondary');
  const provider = withFallback(
    scriptedProvider('primary', trace, [], [failure('first step')]),
    scriptedProvider('secondary', trace, [reply]),
    { onFallback: () => trace.mark('onFallback') },
  );
  const chunks = await drain(
    provider.stream!(request, { onResilience: (event) => trace.mark(event.kind) }),
  );
  expect(chunks).toEqual([terminal(reply)]);
  expect(trace.steps.map(({ action }) => action)).toEqual([
    'primary.stream',
    'onFallback',
    'fell-back',
    'secondary.complete',
  ]);
});

it.each([
  { title: 'first empty chunk then provider failure', finish: 'reject', first: chunk('') },
  { title: 'first content chunk then provider failure', finish: 'reject', first: chunk('primary') },
  { title: 'first empty chunk then consumer return', finish: 'return', first: chunk('') },
  { title: 'first content chunk then consumer return', finish: 'return', first: chunk('primary') },
])('keeps the committed iterator on $title', async ({ finish, first }) => {
  const trace = traceCall();
  const late = failure('after first step');
  const primary = scriptedProvider('primary', trace, [], [[first, late]]);
  const secondary = scriptedProvider('secondary', trace, [answer('must stay unused')]);
  const provider = withRetry(withFallback(primary, secondary), { initialDelayMs: 5 });
  const iterator = provider.stream!(request, {
    onResilience: (event) => trace.mark(event.kind),
  })[Symbol.asyncIterator]();
  try {
    expect((await iterator.next()).value).toBe(first);
    if (finish === 'return') {
      expect((await iterator.return!()).done).toBe(true);
    } else {
      await expect(iterator.next()).rejects.toBe(late);
    }
  } finally {
    await iterator.return?.();
  }
  expect(trace.steps.map(({ action }) => action)).toEqual(['primary.stream', 'primary.close']);
});

it.each(['complete', 'stream'] as const)(
  'does not move a cancelled %s to the fallback',
  async (operation) => {
    const controller = new AbortController();
    const reason = new Error('caller cancelled');
    const trace = traceCall();
    const abortAndFail = () => {
      controller.abort(reason);
      return failure('primary down');
    };
    const primary: LLMProvider =
      operation === 'complete'
        ? scriptedProvider('primary', trace, [
            async () => {
              throw abortAndFail();
            },
          ])
        : {
            ...scriptedProvider('primary', trace, []),
            stream(input) {
              expect(input.signal?.aborted).toBe(false);
              trace.enter('primary', 'stream', input);
              return {
                [Symbol.asyncIterator]() {
                  return {
                    async next() {
                      throw abortAndFail();
                    },
                  };
                },
              };
            },
          };
    const secondary = scriptedProvider('secondary', trace, [answer('must stay unused')], [[]]);
    const provider = withFallback(primary, secondary);
    const req = { ...request, signal: controller.signal };
    const run = operation === 'complete' ? provider.complete(req) : drain(provider.stream!(req));

    await expect(run).rejects.toBe(reason);
    expect(trace.requests.map(({ provider }) => provider)).toEqual(['primary']);
  },
);
