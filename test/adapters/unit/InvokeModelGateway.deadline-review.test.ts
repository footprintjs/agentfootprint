import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invokeModelGateway,
  type InvokeModelGatewayOptions,
} from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';
import { isProviderTimeout } from '../../../src/provider-contract/timeout.js';
const req: LLMRequest = { model: 'invoke-model-gateway', messages: [] };
const never = <T>(): Promise<T> => new Promise(() => undefined);
function gateway(
  fetch: NonNullable<InvokeModelGatewayOptions['fetch']>,
  extra: Partial<InvokeModelGatewayOptions> = {},
) {
  return invokeModelGateway({
    baseUrl: 'https://gateway.example.test',
    apiKeyHeader: 'api-key',
    apiKey: 'fixture',
    model: 'fixture',
    fetch,
    timeoutMs: 20,
    ...extra,
  });
}
function observe(pending: Promise<unknown>) {
  const state: { error?: unknown; done: boolean } = { done: false };
  void pending.then(
    () => {
      state.done = true;
    },
    (error) => Object.assign(state, { error, done: true }),
  );
  return state;
}
async function drain(stream: AsyncIterable<unknown>) {
  for await (const _ of stream) {
    /* consume fixture */
  }
}
function sse(data: unknown) {
  return 'data: ' + JSON.stringify(data) + '\n\n';
}
afterEach(() => vi.useRealTimers());
describe('gateway shared timeout contract — fake HTTP only', () => {
  it('composes the provider timeout contract while keeping its existing error reason', async () => {
    vi.useFakeTimers();
    const provider = gateway(async () => never());
    const result = observe(provider.complete(req));
    await vi.advanceTimersByTimeAsync(20);
    expect(result.error).toMatchObject({
      name: 'InvokeModelGatewayError',
      reason: 'timeout',
      code: 'ERR_PROVIDER_TIMEOUT',
      provider: 'invoke-model-gateway',
      waitingFor: 'response',
      timeoutMs: 20,
      afterOutput: false,
      retryable: true,
      cause: { name: 'ProviderTimeoutError' },
    });
    expect(isProviderTimeout(result.error)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not advise replay after generated tool arguments, before any public text', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            sse({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'tool_use', id: 'call', name: 'lookup', input: {} },
            }) +
              sse({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"q":' },
              }),
          ),
        );
      },
    });
    const provider = gateway(async () => new Response(body));
    const result = observe(drain(provider.stream!(req)));
    await vi.advanceTimersByTimeAsync(20);
    expect(result.error).toMatchObject({ reason: 'timeout', afterOutput: true, retryable: false });
    expect(isProviderTimeout(result.error)).toBe(true);
  });
  it('allows a longer response/start wait than later stream gaps', async () => {
    vi.useFakeTimers();
    const provider = gateway(async () => never(), { timeoutMs: 10, firstEventTimeoutMs: 60 });
    const result = observe(drain(provider.stream!(req)));
    await vi.advanceTimersByTimeAsync(10);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(result.error).toMatchObject({ waitingFor: 'response', timeoutMs: 60 });
  });
  it('bounds a stalled asynchronous key lookup before sending anything', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(''));
    const provider = gateway(fetch, { apiKey: () => never() });
    const result = observe(provider.complete(req));
    await vi.advanceTimersByTimeAsync(20);
    expect(result.error).toMatchObject({ reason: 'timeout' });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['complete', 'stream'] as const)(
    'keeps a non-Error caller abort as AbortError with cause during %s reads',
    async (door) => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const provider = gateway(async () => new Response(new ReadableStream<Uint8Array>()));
      const result = observe(
        door === 'complete'
          ? provider.complete({ ...req, signal: caller.signal })
          : drain(provider.stream!({ ...req, signal: caller.signal })),
      );
      await vi.advanceTimersByTimeAsync(0);
      caller.abort('stop-fixture');
      await vi.advanceTimersByTimeAsync(0);
      expect(result.error).toMatchObject({ name: 'AbortError', cause: 'stop-fixture' });
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('keeps the unreadable-event failure when subsequent cancel times out', async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {broken\n\n'));
      },
      cancel: () => never(),
    });
    const result = observe(drain(gateway(async () => new Response(body)).stream!(req)));
    await vi.advanceTimersByTimeAsync(20);
    expect(result.error).toMatchObject({ reason: 'stream' });
    expect(result.error).not.toHaveProperty('code');
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 2 ** 31])(
    'rejects an invalid timeout %s before transport setup',
    (value) => {
      const fetch = vi.fn();
      expect(() => gateway(fetch, { timeoutMs: value })).toThrow(/timeoutMs/);
      expect(() => gateway(fetch, { firstEventTimeoutMs: value })).toThrow(/firstEventTimeoutMs/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
