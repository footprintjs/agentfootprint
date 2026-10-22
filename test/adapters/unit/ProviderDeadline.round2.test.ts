import { afterEach, describe, expect, it, vi } from 'vitest';
import { bedrock, type BedrockProviderOptions } from '../../../src/adapters/llm/BedrockProvider.js';
import {
  invokeModelGateway,
  type InvokeModelGatewayOptions,
} from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { isBedrockOutputEvent } from '../../../src/adapters/llm/bedrockOutput.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import type { LLMProvider, LLMRequest } from '../../../src/provider-contract/types.js';
const request: LLMRequest = { model: 'fixture', messages: [] };
const later = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const never = () => new Promise<never>(() => undefined);
const answer = { output: { message: { role: 'assistant', content: [{ text: 'ready' }] } } };
const message = {
  id: 'fixture',
  content: [{ type: 'text', text: 'ready' }],
  usage: { input_tokens: 1, output_tokens: 1 },
  stop_reason: 'end_turn',
};
function observe<T>(pending: Promise<T>) {
  const state: { value?: T; error?: unknown } = {};
  void pending.then(
    (value) => {
      state.value = value;
    },
    (error) => {
      state.error = error;
    },
  );
  return state;
}
async function drain(provider: LLMProvider) {
  const rows = [];
  for await (const row of provider.stream!(request)) rows.push(row);
  return rows;
}
function sdk(send: () => Promise<unknown>, options: Record<string, unknown>) {
  class Command {
    constructor(readonly input: unknown) {}
  }
  return bedrock({
    _client: { send },
    _commands: { Converse: Command, ConverseStream: Command },
    ...options,
  } as BedrockProviderOptions);
}
function gateway(
  fetch: NonNullable<InvokeModelGatewayOptions['fetch']>,
  options: Record<string, unknown>,
) {
  return invokeModelGateway({
    baseUrl: 'https://fixture.test',
    apiKeyHeader: 'x-key',
    apiKey: 'fixture',
    model: 'fixture',
    fetch,
    ...options,
  });
}
function wire(value: unknown) {
  return new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n');
}
afterEach(() => vi.useRealTimers());
describe('round two: whole answers and first output, with scripted transports', () => {
  it('counts nonempty generated thinking as output, including redacted bytes', () => {
    expect(
      isBedrockOutputEvent({
        contentBlockDelta: { delta: { reasoningContent: { text: 'thinking' } } },
      }),
    ).toBe(true);
    expect(
      isBedrockOutputEvent({
        contentBlockDelta: {
          delta: { reasoningContent: { redactedContent: new Uint8Array([1]) } },
        },
      }),
    ).toBe(true);
    expect(
      isBedrockOutputEvent({
        contentBlockDelta: { delta: { reasoningContent: { redactedContent: new Uint8Array() } } },
      }),
    ).toBe(false);
  });
  it.each(['bedrock', 'gateway'] as const)(
    '%s allows a healthy 45s complete answer under 30s idle and 120s first-output caps',
    async (kind) => {
      vi.useFakeTimers();
      const calls = vi.fn();
      const options = { timeoutMs: 30_000, firstOutputTimeoutMs: 120_000 };
      const provider =
        kind === 'bedrock'
          ? sdk(async () => {
              calls();
              return later(45_000, answer);
            }, options)
          : gateway(async () => {
              calls();
              return new Response(
                new ReadableStream({
                  start(c) {
                    setTimeout(() => {
                      c.enqueue(new TextEncoder().encode(JSON.stringify(message)));
                      c.close();
                    }, 45_000);
                  },
                }),
              );
            }, options);
      const state = observe(
        withRetry(provider, { maxAttempts: 3, initialDelayMs: 0 }).complete(request),
      );
      await vi.advanceTimersByTimeAsync(45_000);
      expect(state.error).toBeUndefined();
      expect(state.value?.content).toBe('ready');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('allows the SDK no-stream fallback a whole-answer cap', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provider = sdk(async () => (calls++ === 0 ? {} : later(45_000, answer)), {
      timeoutMs: 30_000,
      responseTimeoutMs: 120_000,
    });
    const state = observe(drain(provider));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(state.error).toBeUndefined();
    expect(state.value?.at(-1)?.response?.content).toBe('ready');
    expect(calls).toBe(2);
  });
  it.each(['bedrock', 'gateway'] as const)(
    '%s refuses blind retry for an opaque whole-answer timeout',
    async (kind) => {
      vi.useFakeTimers();
      const calls = vi.fn();
      const provider =
        kind === 'bedrock'
          ? sdk(
              async () => {
                calls();
                return never();
              },
              { responseTimeoutMs: 40 },
            )
          : gateway(
              async () => {
                calls();
                return never();
              },
              { responseTimeoutMs: 40 },
            );
      const state = observe(
        withRetry(provider, { maxAttempts: 3, initialDelayMs: 0 }).complete(request),
      );
      await vi.advanceTimersByTimeAsync(200);
      expect(state.error).toMatchObject({
        waitingFor: 'response',
        retryable: false,
        afterOutput: false,
      });
      expect(calls).toHaveBeenCalledTimes(1);
      expect((state.error as Error).message).toMatch(/unknown/);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(['bedrock', 'gateway'] as const)(
    '%s waits past control preludes until the first actual output',
    async (kind) => {
      vi.useFakeTimers();
      const options = { timeoutMs: 30_000, firstOutputTimeoutMs: 120_000 };
      let index = 0;
      const provider =
        kind === 'bedrock'
          ? sdk(
              async () => ({
                stream: {
                  [Symbol.asyncIterator]: () => ({
                    next: async () =>
                      index++ === 0
                        ? { done: false, value: { messageStart: { role: 'assistant' } } }
                        : index === 2
                        ? later(45_000, {
                            done: false,
                            value: { contentBlockDelta: { delta: { text: 'ready' } } },
                          })
                        : { done: true },
                  }),
                },
              }),
              options,
            )
          : gateway(
              async () =>
                new Response(
                  new ReadableStream({
                    start(c) {
                      c.enqueue(
                        wire({
                          type: 'message_start',
                          message: { id: 'fixture', usage: { input_tokens: 1, output_tokens: 0 } },
                        }),
                      );
                      c.enqueue(new TextEncoder().encode(': keepalive\n\n'));
                      setTimeout(() => {
                        c.enqueue(
                          wire({
                            type: 'content_block_delta',
                            index: 0,
                            delta: { type: 'text_delta', text: 'ready' },
                          }),
                        );
                        c.close();
                      }, 45_000);
                    },
                  }),
                ),
              options,
            );
      const state = observe(drain(provider));
      await vi.advanceTimersByTimeAsync(45_000);
      expect(state.error).toBeUndefined();
      expect(state.value?.map((r) => r.content).join('')).toBe('ready');
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(['bedrock', 'gateway'] as const)(
    '%s cannot extend pre-output allowance forever using control messages',
    async (kind) => {
      vi.useFakeTimers();
      let index = 0;
      const options = { timeoutMs: 10, firstOutputTimeoutMs: 100 };
      const provider =
        kind === 'bedrock'
          ? sdk(
              async () => ({
                stream: {
                  [Symbol.asyncIterator]: () => ({
                    next: async () => {
                      index++;
                      return later(40, {
                        done: false,
                        value: { messageStart: { role: 'assistant' } },
                      });
                    },
                  }),
                },
              }),
              options,
            )
          : gateway(
              async () =>
                new Response(
                  new ReadableStream({
                    pull(c) {
                      return later(40, undefined).then(() =>
                        c.enqueue(new TextEncoder().encode(': keepalive\n\n')),
                      );
                    },
                  }),
                ),
              options,
            );
      const state = observe(drain(provider));
      await vi.advanceTimersByTimeAsync(100);
      expect(state.error).toMatchObject({
        waitingFor: 'first-output',
        timeoutMs: 100,
        afterOutput: false,
      });
      expect(index).toBeLessThanOrEqual(3);
    },
  );
  it.each(['bedrock', 'gateway'] as const)(
    '%s bounds complete with only a first-output cap and does not resend',
    async (kind) => {
      vi.useFakeTimers();
      const calls = vi.fn();
      const options = { firstOutputTimeoutMs: 40 };
      const provider =
        kind === 'bedrock'
          ? sdk(async () => {
              calls();
              return never();
            }, options)
          : gateway(async () => {
              calls();
              return never();
            }, options);
      const state = observe(
        withRetry(provider, { maxAttempts: 3, initialDelayMs: 0 }).complete(request),
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(state.error).toMatchObject({ timeoutMs: 40, retryable: false });
      expect(calls).toHaveBeenCalledTimes(1);
    },
  );
  it('charges gateway headers and body against one whole-answer allowance', async () => {
    vi.useFakeTimers();
    const provider = gateway(
      async () =>
        later(
          30,
          new Response(
            new ReadableStream({
              start(c) {
                setTimeout(() => {
                  c.enqueue(new TextEncoder().encode(JSON.stringify(message)));
                  c.close();
                }, 70);
              },
            }),
          ),
        ),
      { timeoutMs: 10, firstOutputTimeoutMs: 100, responseTimeoutMs: 50 },
    );
    const state = observe(provider.complete(request));
    await vi.advanceTimersByTimeAsync(50);
    expect(state.error).toMatchObject({ waitingFor: 'body', timeoutMs: 50, retryable: false });
  });
  it('names credentials and confirms no-send when a key lookup stalls', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(''));
    const provider = gateway(fetch, { responseTimeoutMs: 30, apiKey: () => never() });
    const state = observe(provider.complete(request));
    await vi.advanceTimersByTimeAsync(30);
    expect(state.error).toMatchObject({ waitingFor: 'credentials' });
    expect((state.error as Error).message).toMatch(/API key lookup.*No provider request was sent/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['bedrock', 'gateway'] as const)(
    '%s keeps empty text events inside the cumulative first-output window',
    async (kind) => {
      vi.useFakeTimers();
      let index = 0;
      const options = { timeoutMs: 10, firstOutputTimeoutMs: 100 };
      const provider =
        kind === 'bedrock'
          ? sdk(
              async () => ({
                stream: {
                  [Symbol.asyncIterator]: () => ({
                    next: async () =>
                      index++ === 0
                        ? { done: false, value: { contentBlockDelta: { delta: { text: '' } } } }
                        : index === 2
                        ? later(45, {
                            done: false,
                            value: { contentBlockDelta: { delta: { text: 'ready' } } },
                          })
                        : { done: true },
                  }),
                },
              }),
              options,
            )
          : gateway(
              async () =>
                new Response(
                  new ReadableStream({
                    start(c) {
                      c.enqueue(
                        wire({
                          type: 'content_block_start',
                          index: 0,
                          content_block: { type: 'text', text: '' },
                        }),
                      );
                      c.enqueue(
                        wire({
                          type: 'content_block_delta',
                          index: 0,
                          delta: { type: 'text_delta', text: '' },
                        }),
                      );
                      setTimeout(() => {
                        c.enqueue(
                          wire({
                            type: 'content_block_delta',
                            index: 0,
                            delta: { type: 'text_delta', text: 'ready' },
                          }),
                        );
                        c.close();
                      }, 45);
                    },
                  }),
                ),
              options,
            );
      const state = observe(drain(provider));
      await vi.advanceTimersByTimeAsync(45);
      expect(state.error).toBeUndefined();
      expect(state.value?.map((r) => r.content).join('')).toBe('ready');
    },
  );
  it('does not retry an opaque no-stream fallback timeout', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const provider = sdk(async () => (calls++ === 0 ? {} : never()), {
      timeoutMs: 10,
      responseTimeoutMs: 40,
    });
    const state = observe(drain(withRetry(provider, { maxAttempts: 3, initialDelayMs: 0 })));
    await vi.advanceTimersByTimeAsync(100);
    expect(state.error).toMatchObject({ waitingFor: 'fallback', retryable: false });
    expect(calls).toBe(2);
  });
  it('does not replay generated redacted thinking before any public text', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                wire({
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'redacted_thinking', data: 'opaque-generated-block' },
                }),
              );
            },
          }),
        ),
    );
    const provider = gateway(fetch, { timeoutMs: 10, firstOutputTimeoutMs: 40 });
    const state = observe(drain(withRetry(provider, { maxAttempts: 3, initialDelayMs: 0 })));
    await vi.advanceTimersByTimeAsync(150);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.error).toMatchObject({ waitingFor: 'chunk', afterOutput: true, retryable: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an empty redacted-thinking block inside the first-output allowance', async () => {
    vi.useFakeTimers();
    const provider = gateway(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                wire({
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'redacted_thinking', data: '' },
                }),
              );
              setTimeout(() => {
                controller.enqueue(
                  wire({
                    type: 'content_block_delta',
                    index: 1,
                    delta: { type: 'text_delta', text: 'ready' },
                  }),
                );
                controller.close();
              }, 45);
            },
          }),
        ),
      { timeoutMs: 10, firstOutputTimeoutMs: 100 },
    );
    const state = observe(drain(provider));
    await vi.advanceTimersByTimeAsync(45);
    expect(state.error).toBeUndefined();
    expect(state.value?.map((row) => row.content).join('')).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });
});
