import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bedrock,
  type BedrockProviderOptions,
  type BedrockStreamEvent,
} from '../../../src/adapters/llm/BedrockProvider.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import type { LLMChunk, LLMRequest } from '../../../src/provider-contract/types.js';
const req: LLMRequest = { model: 'bedrock', messages: [{ role: 'user', content: 'fixture' }] };
const never = <T>(): Promise<T> => new Promise(() => undefined);
const text = (value: string): BedrockStreamEvent => ({
  contentBlockDelta: { delta: { text: value } },
});
function fixture(
  send: (command: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>,
  options: Record<string, unknown> = {},
) {
  class Command {
    constructor(readonly input: unknown) {}
  }
  const client = { send: vi.fn(send) };
  return {
    client,
    provider: bedrock({
      _client: client,
      _commands: { Converse: Command, ConverseStream: Command },
      timeoutMs: 20,
      ...options,
    } as BedrockProviderOptions),
  };
}
function events(
  next: () => Promise<IteratorResult<BedrockStreamEvent>>,
  close = async (): Promise<IteratorResult<BedrockStreamEvent>> => ({
    done: true,
    value: undefined,
  }),
) {
  return { stream: { [Symbol.asyncIterator]: () => ({ next, return: vi.fn(close) }) } };
}
function watch<T>(pending: Promise<T>) {
  const value: { state: string; error?: unknown; result?: T } = { state: 'pending' };
  void pending.then(
    (result) => Object.assign(value, { state: 'resolved', result }),
    (error) => Object.assign(value, { state: 'rejected', error }),
  );
  return value;
}
async function drain(stream: AsyncIterable<LLMChunk>) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
}
afterEach(() => vi.useRealTimers());
describe('Bedrock review regressions — scripted transport only', () => {
  it('bounds direct complete and reaches its SDK signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { provider } = fixture(async (_command, options) => {
      signal = options?.abortSignal;
      return never();
    });
    const pending = watch(provider.complete(req));
    await vi.advanceTimersByTimeAsync(20);
    expect(pending).toMatchObject({
      state: 'rejected',
      error: {
        code: 'ERR_PROVIDER_TIMEOUT',
        provider: 'bedrock',
        waitingFor: 'response',
        afterOutput: false,
        retryable: true,
      },
    });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('allows a longer first event without lengthening the idle cap', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { provider } = fixture(
      async () =>
        events(async () =>
          n++ === 0
            ? await new Promise((resolve) =>
                setTimeout(() => resolve({ done: false, value: text('ready') }), 50),
              )
            : never(),
        ),
      { timeoutMs: 10, firstEventTimeoutMs: 100 },
    );
    const iterator = provider.stream!(req)[Symbol.asyncIterator]();
    const first = watch(iterator.next());
    await vi.advanceTimersByTimeAsync(50);
    expect(first).toMatchObject({ state: 'resolved', result: { value: { content: 'ready' } } });
    const next = watch(iterator.next());
    await vi.advanceTimersByTimeAsync(10);
    expect(next).toMatchObject({
      state: 'rejected',
      error: {
        code: 'ERR_PROVIDER_TIMEOUT',
        waitingFor: 'chunk',
        afterOutput: true,
        retryable: false,
      },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the first-event allowance while opening the SDK response', async () => {
    vi.useFakeTimers();
    const { provider } = fixture(async () => never(), { timeoutMs: 10, firstEventTimeoutMs: 60 });
    const pending = watch(provider.stream!(req)[Symbol.asyncIterator]().next());
    await vi.advanceTimersByTimeAsync(10);
    expect(pending.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(50);
    expect(pending).toMatchObject({
      state: 'rejected',
      error: { waitingFor: 'response', timeoutMs: 60 },
    });
  });
  it('does not retry generated tool arguments that have not become public chunks', async () => {
    vi.useFakeTimers();
    let n = 0;
    const stream = events(async () => {
      if (n++ === 0)
        return {
          done: false,
          value: {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { toolUseId: 'call', name: 'lookup' } },
            },
          },
        };
      if (n < 42)
        return {
          done: false,
          value: {
            contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: 'x' } } },
          },
        };
      return never();
    });
    const { provider, client } = fixture(async () => stream);
    const wrapped = withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 });
    const pending = watch(drain(wrapped.stream!(req)));
    await vi.advanceTimersByTimeAsync(40);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(pending).toMatchObject({
      state: 'rejected',
      error: { afterOutput: true, retryable: false },
    });
  });
  it('keeps malformed tool JSON when cleanup later times out', async () => {
    vi.useFakeTimers();
    let n = 0;
    const rows: BedrockStreamEvent[] = [
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: 'call', name: 'lookup' } },
        },
      },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { toolUse: { input: '{bad' } } } },
      { contentBlockStop: { contentBlockIndex: 0 } },
    ];
    const { provider } = fixture(async () =>
      events(
        async () => ({ done: false, value: rows[n++] }),
        () => never(),
      ),
    );
    const pending = watch(drain(provider.stream!(req)));
    await vi.advanceTimersByTimeAsync(20);
    expect(pending).toMatchObject({
      state: 'rejected',
      error: { code: 'BEDROCK_MALFORMED_TOOL_ARGS' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a non-timeout provider failure when closing also stalls', async () => {
    vi.useFakeTimers();
    const error = Object.assign(new Error('throttled'), { $metadata: { httpStatusCode: 429 } });
    const { provider } = fixture(async () =>
      events(
        async () => {
          throw error;
        },
        () => never(),
      ),
    );
    const pending = watch(drain(provider.stream!(req)));
    await vi.advanceTimersByTimeAsync(20);
    expect(pending).toMatchObject({
      state: 'rejected',
      error: { name: 'BedrockProviderError', status: 429 },
    });
  });
  it('keeps the caller cancellation after public output and closes once', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new Error('caller stopped');
    let n = 0;
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    let signal: AbortSignal | undefined;
    const { provider } = fixture(async (_command, options) => {
      signal = options?.abortSignal;
      return events(
        async () => (n++ === 0 ? { done: false, value: text('partial') } : never()),
        close,
      );
    });
    const iterator = provider.stream!({ ...req, signal: caller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value.content).toBe('partial');
    const result = watch(iterator.next());
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.error).toBe(reason);
    expect(signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['caller', 'deadline'] as const)(
    'the first registered %s wins a same-tick race',
    async (winner) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const reason = new Error('caller stopped');
      const { provider } = fixture(async () => never());
      if (winner === 'caller') setTimeout(() => caller.abort(reason), 20);
      const result = watch(provider.complete({ ...req, signal: caller.signal }));
      if (winner === 'deadline') setTimeout(() => caller.abort(reason), 20);
      await vi.advanceTimersByTimeAsync(20);
      if (winner === 'caller') expect(result.error).toBe(reason);
      else expect(result.error).toMatchObject({ code: 'ERR_PROVIDER_TIMEOUT' });
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('leaves an uncapped complete call on the exact caller signal with no timer', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    let signal: AbortSignal | undefined;
    const { provider } = fixture(
      async (_command, options) => {
        signal = options?.abortSignal;
        return { output: { message: { role: 'assistant', content: [{ text: 'ready' }] } } };
      },
      { timeoutMs: undefined },
    );
    expect((await provider.complete({ ...req, signal: caller.signal })).content).toBe('ready');
    expect(signal).toBe(caller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 2 ** 31])(
    'rejects invalid first-event allowance %s before SDK access',
    (value) => {
      const send = vi.fn();
      expect(() => fixture(send, { firstEventTimeoutMs: value })).toThrow(/firstEventTimeoutMs/);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('records timeout as the retry reason before output', async () => {
    vi.useFakeTimers();
    const reports: unknown[] = [];
    let n = 0;
    const { provider } = fixture(async () =>
      n++ === 0 ? never() : events(async () => ({ done: true, value: undefined })),
    );
    const wrapped = withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 });
    const pending = watch(drain(wrapped.stream!(req, { onResilience: (r) => reports.push(r) })));
    await vi.advanceTimersByTimeAsync(20);
    expect(pending.state).toBe('resolved');
    expect(reports).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'timeout' })]),
    );
  });
});
