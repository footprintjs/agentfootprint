import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bedrock,
  type BedrockProviderOptions,
  type BedrockStreamEvent,
} from '../../../src/adapters/llm/BedrockProvider.js';
import type { LLMChunk, LLMRequest } from '../../../src/provider-contract/types.js';
import { withRetry } from '../../../src/resilience/withRetry.js';

const request: LLMRequest = { model: 'bedrock', messages: [{ role: 'user', content: 'fixture' }] };
const never = <T>(): Promise<T> => new Promise(() => undefined);
const text = (content: string): BedrockStreamEvent => ({
  contentBlockDelta: { delta: { text: content } },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function events(
  next: () => Promise<IteratorResult<BedrockStreamEvent>>,
  close: () => Promise<IteratorResult<BedrockStreamEvent>> = vi.fn(async () => ({
    done: true as const,
    value: undefined,
  })),
) {
  return { stream: { [Symbol.asyncIterator]: () => ({ next, return: close }) }, close };
}

function ready() {
  let index = 0;
  return events(async () =>
    index++ === 0 ? { done: false, value: text('ok') } : { done: true, value: undefined },
  );
}

function setup(
  send: (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>,
  options: Partial<BedrockProviderOptions> = {},
) {
  class Command {
    constructor(readonly input: unknown) {}
  }
  const client = { send: vi.fn(send) };
  const provider = bedrock({
    _client: client,
    _commands: { Converse: Command, ConverseStream: Command },
    ...options,
  });
  return { provider, client };
}

function watch<T>(pending: Promise<T>) {
  const result: { state: 'pending' | 'resolved' | 'rejected'; value?: T; error?: unknown } = {
    state: 'pending',
  };
  const done = pending.then(
    (value) => {
      result.state = 'resolved';
      result.value = value;
    },
    (error) => {
      result.state = 'rejected';
      result.error = error;
    },
  );
  return { result, done };
}

async function drain(source: AsyncIterable<LLMChunk>) {
  const result: LLMChunk[] = [];
  for await (const chunk of source) result.push(chunk);
  return result;
}

afterEach(() => vi.useRealTimers());

describe('Bedrock stream deadlines — scripted SDK, no AWS calls', () => {
  it('bounds a missing SDK response and aborts the actual request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { provider } = setup(
      async (_command, options) => {
        signal = options?.abortSignal;
        return never();
      },
      { timeoutMs: 20 },
    );
    const observed = watch(provider.stream!(request)[Symbol.asyncIterator]().next());
    await vi.advanceTimersByTimeAsync(20);
    expect(observed.result).toMatchObject({
      state: 'rejected',
      error: {
        name: 'ProviderTimeoutError',
        code: 'ERR_PROVIDER_TIMEOUT',
        retryable: true,
        waitingFor: 'response',
      },
    });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['first', 'later'])(
    'bounds the %s event read and requests transport cleanup once',
    async (position) => {
      vi.useFakeTimers();
      let index = 0;
      const source = events(async () =>
        position === 'later' && index++ === 0 ? { done: false, value: text('partial') } : never(),
      );
      const { provider } = setup(async () => source, {
        timeoutMs: 20,
      });
      const iterator = provider.stream!(request)[Symbol.asyncIterator]();
      if (position === 'later') expect((await iterator.next()).value.content).toBe('partial');
      const observed = watch(iterator.next());
      await vi.advanceTimersByTimeAsync(20);
      expect(observed.result).toMatchObject({
        state: 'rejected',
        error: {
          code: 'ERR_PROVIDER_TIMEOUT',
          waitingFor: position === 'first' ? 'first-event' : 'chunk',
          afterOutput: position === 'later',
          retryable: position !== 'later',
        },
      });
      expect(source.close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds an early close whose return never settles', async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => never<IteratorResult<BedrockStreamEvent>>());
    const source = events(async () => ({ done: false, value: text('partial') }), close);
    const { provider } = setup(async () => source, {
      timeoutMs: 20,
    });
    const iterator = provider.stream!(request)[Symbol.asyncIterator]();
    await iterator.next();
    const observed = watch(iterator.return!());
    await vi.advanceTimersByTimeAsync(20);
    expect(observed.result).toMatchObject({
      state: 'rejected',
      error: { code: 'ERR_PROVIDER_TIMEOUT', waitingFor: 'close' },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('withRetry retries a timeout before any public chunk, then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { provider } = setup(async () => (++calls === 1 ? never() : ready()), {
      timeoutMs: 20,
    });
    const retried = withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 });
    const observed = watch(drain(retried.stream!(request)));
    await vi.advanceTimersByTimeAsync(50);
    expect(observed.result.state).toBe('resolved');
    expect(observed.result.value?.at(-1)?.response?.content).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not replay text after a later timeout, even with withRetry', async () => {
    vi.useFakeTimers();
    let index = 0;
    const source = events(async () =>
      index++ === 0 ? { done: false, value: text('partial') } : never(),
    );
    const { provider, client } = setup(async () => source, {
      timeoutMs: 20,
    });
    const iterator = withRetry(provider, { maxAttempts: 3, initialDelayMs: 0 }).stream!(request)[
      Symbol.asyncIterator
    ]();
    expect((await iterator.next()).value.content).toBe('partial');
    const observed = watch(iterator.next());
    await vi.advanceTimersByTimeAsync(100);
    expect(observed.result).toMatchObject({
      state: 'rejected',
      error: { code: 'ERR_PROVIDER_TIMEOUT' },
    });
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('caller cancellation keeps its identity and does not wait for the timeout', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('caller fixture');
    const { provider } = setup(async () => never(), {
      timeoutMs: 20,
    });
    const observed = watch(
      provider.stream!({ ...request, signal: controller.signal })
        [Symbol.asyncIterator]()
        .next(),
    );
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(observed.result.error).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not count consumer backpressure as provider idle time', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { provider } = setup(
      async (_cmd, options) => {
        signal = options?.abortSignal;
        return ready();
      },
      { timeoutMs: 20 },
    );
    const iterator = provider.stream!(request)[Symbol.asyncIterator]();
    expect((await iterator.next()).value.content).toBe('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(false);
    expect((await iterator.next()).value.done).toBe(true);
    await iterator.next();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('without a timeout sends exactly the caller signal and creates no timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { provider, client } = setup(async () => ready());
    await drain(provider.stream!({ ...request, signal: controller.signal }));
    expect(client.send.mock.calls[0][1]).toEqual({ abortSignal: controller.signal });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not dispatch under an already cancelled signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const { provider, client } = setup(async () => ready(), {
      timeoutMs: 20,
    });
    await expect(
      drain(provider.stream!({ ...request, signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.send).not.toHaveBeenCalled();
  });

  it('discards a late SDK stream without starting a fresh iterator or accepting usage', async () => {
    vi.useFakeTimers();
    const response = deferred<unknown>();
    const iteratorRequests = vi.fn(() => ready().stream[Symbol.asyncIterator]());
    const { provider } = setup(async () => response.promise, { timeoutMs: 20 });
    const observed = watch(drain(provider.stream!(request)));
    await vi.advanceTimersByTimeAsync(20);
    expect(observed.result.state).toBe('rejected');
    response.resolve({ stream: { [Symbol.asyncIterator]: iteratorRequests } });
    await vi.advanceTimersByTimeAsync(0);
    expect(iteratorRequests).not.toHaveBeenCalled();
    expect(observed.result).not.toHaveProperty('value');
  });

  it('bounds a non-stream fallback without adding another retry loop', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { provider, client } = setup(async () => (++calls === 1 ? {} : never()), {
      timeoutMs: 20,
    });
    const observed = watch(drain(provider.stream!(request)));
    await vi.advanceTimersByTimeAsync(20);
    expect(observed.result).toMatchObject({
      state: 'rejected',
      error: { code: 'ERR_PROVIDER_TIMEOUT', waitingFor: 'fallback' },
    });
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('resets the cap for each event rather than cutting a healthy long stream', async () => {
    vi.useFakeTimers();
    let index = 0;
    const source = events(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                index++ < 5 ? { done: false, value: text('ok') } : { done: true, value: undefined },
              ),
            10,
          ),
        ),
    );
    const { provider } = setup(async () => source, { timeoutMs: 20 });
    const observed = watch(drain(provider.stream!(request)));
    await vi.advanceTimersByTimeAsync(100);
    expect(observed.result.state).toBe('resolved');
    expect(observed.result.value?.at(-1)?.response?.content).toBe('ok'.repeat(5));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps two concurrent calls and their caller signal isolated', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const second = deferred<unknown>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const { provider } = setup(
      async (_cmd, options) => {
        signals.push(options!.abortSignal!);
        return ++calls === 1 ? never() : second.promise;
      },
      { timeoutMs: 20 },
    );
    const first = watch(drain(provider.stream!({ ...request, signal: caller.signal })));
    await vi.advanceTimersByTimeAsync(10);
    const later = watch(drain(provider.stream!({ ...request, signal: caller.signal })));
    await vi.advanceTimersByTimeAsync(10);
    expect(first.result.state).toBe('rejected');
    expect(later.result.state).toBe('pending');
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(caller.signal.aborted).toBe(false);
    second.resolve(ready());
    await vi.advanceTimersByTimeAsync(0);
    expect(later.result.state).toBe('resolved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the caller listener when a healthy stream ends', async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const { provider } = setup(async () => ready(), { timeoutMs: 20 });
    await drain(provider.stream!({ ...request, signal: caller.signal }));
    const listener = add.mock.calls.find(([name]) => name === 'abort')![1];
    expect(remove).toHaveBeenCalledWith('abort', listener);
  });

  it('handles a late transport rejection and never includes request data in the timeout', async () => {
    vi.useFakeTimers();
    const response = deferred<unknown>();
    const { provider } = setup(async () => response.promise, { timeoutMs: 20 });
    const observed = watch(
      drain(
        provider.stream!({
          model: 'sensitive-model-fixture',
          messages: [{ role: 'user', content: 'sensitive-prompt-fixture' }],
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(20);
    const error = observed.result.error as Error;
    expect(error.message).not.toContain('sensitive');
    expect(error).not.toHaveProperty('cause');
    response.reject(new Error('sensitive-transport-fixture'));
    await vi.advanceTimersByTimeAsync(0);
    expect(observed.result.error).toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, 2 ** 31, '20', null])(
    'refuses invalid timeout %s before constructing or calling an SDK',
    (timeoutMs) => {
      const client = { send: vi.fn() };
      expect(() =>
        bedrock({ _client: client, timeoutMs } as unknown as BedrockProviderOptions),
      ).toThrow(/timeoutMs/);
      expect(client.send).not.toHaveBeenCalled();
    },
  );
});
