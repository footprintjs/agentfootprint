/** Leaf transports enforce and report the shared replay plan before any I/O. */
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { invokeModelGateway } from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import {
  fromAnthropicResponse,
  type AnthropicMessage,
  type AnthropicMessagesBody,
} from '../../../src/adapters/llm/anthropicMessagesWire.js';
import { thinkingReplayBinding } from '../../../src/adapters/llm/anthropicThinkingReplay.js';
import { anthropicThinkingHandler } from '../../../src/thinking/AnthropicThinkingHandler.js';
import type {
  LLMCallHooks,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/adapters/types.js';

const MODEL = 'claude-sonnet-4-6';
const response: AnthropicMessage = {
  id: 'actual-reply',
  role: 'assistant',
  model: MODEL,
  content: [{ type: 'text', text: 'answer' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 2, output_tokens: 3 },
};
const sse = [
  { type: 'message_start', message: { ...response, content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
  { type: 'message_stop' },
]
  .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

function request(completed: boolean): LLMRequest {
  const earlier = fromAnthropicResponse({
    ...response,
    id: 'earlier',
    stop_reason: completed ? 'end_turn' : 'tool_use',
    content: [
      { type: 'text', text: 'before' },
      { type: 'thinking', thinking: 'private reasoning', signature: '' },
      { type: 'text', text: 'after' },
      ...(completed
        ? []
        : [{ type: 'tool_use' as const, id: 'lookup', name: 'lookup', input: {} }]),
    ],
  });
  return {
    model: MODEL,
    messages: [
      { role: 'user', content: 'original' },
      {
        role: 'assistant',
        content: earlier.content,
        toolCalls: earlier.toolCalls,
        thinkingBlocks: anthropicThinkingHandler.normalize(earlier.rawThinking),
        replay: earlier.replay,
      },
      ...(completed
        ? [{ role: 'user' as const, content: 'continue' }]
        : [{ role: 'tool' as const, content: 'result', toolCallId: 'lookup' }]),
    ],
  };
}

function harness(kind: string, mode: string, fail = false, reply = response, streamBody = sse) {
  const order: string[] = [];
  const bodies: AnthropicMessagesBody[] = [];
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    order.push('transport');
    bodies.push(JSON.parse(String(init?.body)) as AnthropicMessagesBody);
    if (fail) throw new Error('network unavailable');
    return new Response(mode === 'complete' ? JSON.stringify(reply) : streamBody);
  });
  const key = vi.fn(async () => {
    order.push('key');
    return 'not-a-real-key';
  });
  const sdkCall = (body: AnthropicMessagesBody) => {
    order.push('transport');
    bodies.push(body);
    if (fail) throw new Error('network unavailable');
  };
  const client = {
    messages: {
      create: vi.fn(async (body: AnthropicMessagesBody) => {
        sdkCall(body);
        return reply;
      }),
      stream: vi.fn((body: AnthropicMessagesBody) => {
        sdkCall(body);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_stop' };
          },
          async finalMessage() {
            return reply;
          },
        };
      }),
    },
  };
  const provider =
    kind === 'sdk'
      ? new AnthropicProvider({ _client: client })
      : kind === 'browser'
      ? browserAnthropic({ apiKey: 'not-a-real-key', _fetch: transport })
      : invokeModelGateway({
          baseUrl: 'https://gateway.invalid',
          apiKeyHeader: 'x-test-key',
          apiKey: key,
          fetch: transport,
        });
  return { provider, order, bodies, transport, key, client };
}

async function invoke(
  provider: LLMProvider,
  mode: string,
  req: LLMRequest,
  hooks?: LLMCallHooks,
): Promise<LLMResponse> {
  if (mode === 'complete') return provider.complete(req, hooks);
  let result: LLMResponse | undefined;
  for await (const chunk of provider.stream!(req, hooks))
    if (chunk.response) result = chunk.response;
  if (!result) throw new Error('missing terminal response');
  return result;
}

describe.each(['sdk', 'browser', 'gateway'])('%s replay leaf', (kind) => {
  it.each(['complete', 'stream'])(
    '%s reports a completed-turn omission before transport and preserves text order',
    async (mode) => {
      const h = harness(kind, mode);
      const req = request(true);
      const onReplayPrepared = vi.fn(() => {
        h.order.push('report');
      });
      const answer = await invoke(h.provider, mode, req, { onReplayPrepared });
      expect(h.order).toEqual(
        kind === 'gateway' ? ['report', 'key', 'transport'] : ['report', 'transport'],
      );
      expect(onReplayPrepared).toHaveBeenCalledOnce();
      expect(answer.replayOmissions).toHaveLength(1);
      expect(answer.replayOmissions?.[0]).toMatchObject({
        messageIndex: 1,
        blockIndex: 0,
        reason: 'missing-signature',
      });
      expect(h.bodies[0]?.messages[1]?.content).toEqual([
        { type: 'text', text: 'before' },
        { type: 'text', text: 'after' },
      ]);
      expect(req.messages[1]?.thinkingBlocks).toHaveLength(1);
      expect(answer.replay?.stopReason).toBe('end_turn');
      expect(answer.replay?.binding).toEqual(
        thinkingReplayBinding(h.bodies[0]!, MODEL)('actual-reply'),
      );
    },
  );

  it.each(['complete', 'stream'])(
    '%s refuses unsafe active thinking without wrapping, key lookup or dispatch',
    async (mode) => {
      const h = harness(kind, mode);
      const hook = vi.fn();
      await expect(
        invoke(h.provider, mode, request(false), { onReplayPrepared: hook }),
      ).rejects.toMatchObject({
        name: 'UnsafeThinkingReplayError',
        reason: 'missing-signature',
        retryable: false,
      });
      expect(h.order).toEqual([]);
      expect(hook).not.toHaveBeenCalled();
    },
  );

  it.each(['complete', 'stream'])(
    '%s reports the prepared omission even when transport fails',
    async (mode) => {
      const h = harness(kind, mode, true);
      const hook = vi.fn(() => {
        h.order.push('report');
      });
      await expect(
        invoke(h.provider, mode, request(true), { onReplayPrepared: hook }),
      ).rejects.toThrow('network unavailable');
      expect(h.order[0]).toBe('report');
      expect(hook).toHaveBeenCalledOnce();
    },
  );

  it.each(['complete', 'stream'])(
    '%s does not report omissions on an ordinary call',
    async (mode) => {
      const h = harness(kind, mode);
      const hook = vi.fn();
      const result = await invoke(
        h.provider,
        mode,
        { model: MODEL, messages: [{ role: 'user', content: 'hello' }] },
        { onReplayPrepared: hook },
      );
      expect(hook).not.toHaveBeenCalled();
      expect(result.replayOmissions).toBeUndefined();
      expect(result.replay?.id).toBe('actual-reply');
    },
  );

  it.each(['complete', 'stream'])(
    '%s leaves an observer failure unwrapped and never dispatches',
    async (mode) => {
      const h = harness(kind, mode);
      const refused = new Error('recorder unavailable');
      await expect(
        invoke(h.provider, mode, request(true), {
          onReplayPrepared: () => {
            throw refused;
          },
        }),
      ).rejects.toBe(refused);
      expect(h.order).toEqual([]);
    },
  );
});

function stored(answer: LLMResponse): LLMMessage {
  return JSON.parse(
    JSON.stringify({
      role: 'assistant',
      content: answer.content,
      toolCalls: answer.toolCalls,
      thinkingBlocks: anthropicThinkingHandler.normalize(answer.rawThinking),
      replay: answer.replay,
    }),
  ) as LLMMessage;
}

function fullStream(message: AnthropicMessage): string {
  return [
    { type: 'message_start', message: { ...message, content: [] } },
    ...message.content.flatMap((content_block, index) => [
      { type: 'content_block_start', index, content_block },
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason: message.stop_reason } },
    { type: 'message_stop' },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
}

describe.each(['sdk', 'browser', 'gateway'])('%s durable known-loss evidence', (kind) => {
  it.each([
    ['complete', 'citation'],
    ['stream', 'citation'],
    ['complete', 'unknown block'],
    ['stream', 'unknown block'],
  ])('%s refuses its own unsupported %s active response on replay', async (mode, variant) => {
    const reply: AnthropicMessage = {
      ...response,
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'private', signature: 'signature' },
        // A genuine forward-compatible wire field, not represented by LLMMessage.
        variant === 'citation'
          ? { type: 'text', text: 'cited', citations: [{ source: 'private source' }] }
          : { type: 'server_tool_use', name: 'search', input: { query: 'private source' } },
        { type: 'tool_use', id: 'lookup', name: 'lookup', input: {} },
      ] as AnthropicMessage['content'],
    };
    const h = harness(kind, mode, false, reply, fullStream(reply));
    const first = await invoke(h.provider, mode, {
      model: MODEL,
      messages: [{ role: 'user', content: 'hello' }],
    });
    const message = stored(first);
    expect(message.replay).toMatchObject({
      lossy: true,
      contentDigest: '',
      layout: [{ type: 'thinking', index: 0 }],
    });
    expect(JSON.stringify(message.replay)).not.toContain('private');
    const before = [...h.order];
    await expect(
      invoke(h.provider, mode, {
        model: MODEL,
        messages: [
          { role: 'user', content: 'hello' },
          message,
          { role: 'tool', content: 'result', toolCallId: 'lookup' },
        ],
      }),
    ).rejects.toMatchObject({ name: 'UnsafeThinkingReplayError', reason: 'content-changed' });
    expect(h.order).toEqual(before);
    // Losing the normalized block as well must not erase the observed loss.
    await expect(
      invoke(h.provider, mode, {
        model: MODEL,
        messages: [
          { role: 'user', content: 'hello' },
          { ...message, thinkingBlocks: [] },
          { role: 'tool', content: 'result', toolCallId: 'lookup' },
        ],
      }),
    ).rejects.toMatchObject({ name: 'UnsafeThinkingReplayError', reason: 'content-changed' });
    expect(h.order).toEqual(before);
  });

  it.each(['complete', 'stream'])(
    '%s retires completed known-loss thinking without inventing a new proof',
    async (mode) => {
      const reply: AnthropicMessage = {
        ...response,
        content: [
          { type: 'thinking', thinking: 'private', signature: 'signature' },
          { type: 'text', text: 'cited', citations: [{ source: 'private source' }] },
        ] as AnthropicMessage['content'],
      };
      const h = harness(kind, mode, false, reply, fullStream(reply));
      const first = await invoke(h.provider, mode, {
        model: MODEL,
        messages: [{ role: 'user', content: 'hello' }],
      });
      const observer = vi.fn();
      const second = await invoke(
        h.provider,
        mode,
        {
          model: MODEL,
          messages: [
            { role: 'user', content: 'hello' },
            stored(first),
            { role: 'user', content: 'next' },
          ],
        },
        { onReplayPrepared: observer },
      );
      const preparation = observer.mock.calls[0]?.[0];
      expect(preparation.request.messages[1].replay).toMatchObject({
        lossy: true,
        thinkingRetired: true,
        contentDigest: '',
      });
      expect(second.replayOmissions).toHaveLength(1);
      expect(second.replayOmissions?.[0]?.reason).toBe('content-changed');
    },
  );
});

describe.each(['browser', 'gateway'])('%s incomplete stream evidence', (kind) => {
  it('does not treat a received end_turn delta without message_stop as completion', async () => {
    const reply: AnthropicMessage = {
      ...response,
      content: [
        { type: 'thinking', thinking: 'private', signature: 'signature' },
        { type: 'text', text: 'partial' },
      ],
    };
    const h = harness(
      kind,
      'stream',
      false,
      reply,
      fullStream(reply).replace('event: message_stop\ndata: {"type":"message_stop"}\n\n', ''),
    );
    const first = await invoke(h.provider, 'stream', {
      model: MODEL,
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(first.replay).toMatchObject({ lossy: true, stopReason: '' });
    const before = [...h.order];
    await expect(
      invoke(h.provider, 'stream', {
        model: MODEL,
        messages: [
          { role: 'user', content: 'hello' },
          stored(first),
          { role: 'user', content: 'continue' },
        ],
      }),
    ).rejects.toMatchObject({ name: 'UnsafeThinkingReplayError', reason: 'content-changed' });
    expect(h.order).toEqual(before);
  });
});

describe.each(['sdk', 'browser', 'gateway'])('%s actual response model', (kind) => {
  it.each([
    ['complete', 'claude-sonnet-4-6'],
    ['stream', 'claude-sonnet-4-6'],
    ['complete', 'opaque-server-fallback'],
    ['stream', 'opaque-server-fallback'],
  ])(
    '%s records returned %s rather than claiming the requested bound model',
    async (mode, model) => {
      const reply: AnthropicMessage = {
        ...response,
        model,
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: 'private', signature: 'signature' },
          { type: 'tool_use', id: 'lookup', name: 'lookup', input: {} },
        ],
      };
      const h = harness(kind, mode, false, reply, fullStream(reply));
      const req: LLMRequest = {
        model: 'claude-sonnet-5-5',
        systemPrompt: 'original',
        messages: [{ role: 'user', content: 'hello' }],
      };
      const first = await invoke(h.provider, mode, req);
      expect(first.replay?.binding?.model).toBe(model);
      // Only actual same-family origin establishes the documented prefix rule.
      // Changing a prefix is not a locally provable refusal for these origins.
      const second = await invoke(h.provider, mode, {
        ...req,
        systemPrompt: 'changed',
        messages: [
          ...req.messages,
          stored(first),
          { role: 'tool', content: 'result', toolCallId: 'lookup' },
        ],
      });
      expect(second.replayOmissions).toBeUndefined();
      expect(h.bodies).toHaveLength(2);
    },
  );
});

describe('gateway asynchronous key lookup', () => {
  it.each(['complete', 'stream'])('%s binds and sends the pre-await body', async (mode) => {
    const values = ['original'];
    const req: LLMRequest = {
      model: MODEL,
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          name: 'lookup',
          description: 'Lookup',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string', enum: values } },
          },
        },
      ],
    };
    let sent: AnthropicMessagesBody | undefined;
    const provider = invokeModelGateway({
      baseUrl: 'https://gateway.invalid',
      apiKeyHeader: 'x-test-key',
      apiKey: async () => {
        await Promise.resolve();
        values[0] = 'changed during key lookup';
        return 'not-a-real-key';
      },
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as AnthropicMessagesBody;
        return new Response(mode === 'complete' ? JSON.stringify(response) : sse);
      },
    });
    const answer = await invoke(provider, mode, req);
    expect(JSON.stringify(sent?.tools)).toContain('original');
    expect(JSON.stringify(sent?.tools)).not.toContain('changed during key lookup');
    expect(answer.replay?.binding).toEqual(thinkingReplayBinding(sent!, MODEL)('actual-reply'));
  });
});
