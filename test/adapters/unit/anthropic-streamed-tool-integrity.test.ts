/**
 * Streamed argument integrity through the public provider factories.
 * The SDK seam supplies decoded events plus an explicitly scripted repaired
 * finalMessage: it is not a substitute implementation of the SDK parser.
 * Browser/gateway controls use byte-chunked fetch responses. No network/keys.
 */
import { describe, expect, it, vi } from 'vitest';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import {
  invokeModelGateway,
  InvokeModelGatewayError,
} from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import type {
  LLMChunk,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/adapters/types.js';

const MODEL = 'claude-haiku-4-5-20251001';
const request: LLMRequest = {
  model: MODEL,
  messages: [{ role: 'user', content: 'Use the optional-argument lookup tool.' }],
  tools: [{ name: 'lookup', description: 'Read a local record.', inputSchema: { type: 'object' } }],
};
type Block =
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string };
interface Message {
  id: string;
  model: string;
  role: 'assistant';
  content: Block[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}
interface Event {
  type: string;
  index?: number;
  message?: Message;
  content_block?: Block;
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens: number };
}
interface Fixture {
  events: Event[];
  final: Message;
  abort?: Error;
}

const startTool = (index: number, id = 'same-id', name = 'lookup'): Event => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'tool_use', id, name, input: {} },
});
const fragment = (index: number, partial_json: string): Event => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'input_json_delta', partial_json },
});
const stopTool = (index: number): Event => ({ type: 'content_block_stop', index });
const terminal = (reason = 'tool_use'): Event[] => [
  {
    type: 'message_delta',
    delta: { type: 'message_delta', stop_reason: reason },
    usage: { output_tokens: 7 },
  },
  { type: 'message_stop' },
];
function fixture({
  parts = ['{}'],
  input = {},
  closed = true,
  stopped = true,
  reason = 'tool_use',
  thinking = false,
}: {
  parts?: string[];
  input?: Record<string, unknown>;
  closed?: boolean;
  stopped?: boolean;
  reason?: string;
  thinking?: boolean;
} = {}): Fixture {
  const prefix: Block[] = thinking
    ? [{ type: 'thinking', thinking: 'Signed local fixture.', signature: 'signature-unchanged' }]
    : [];
  const index = prefix.length;
  const final: Message = {
    id: 'message-fixture',
    model: MODEL,
    role: 'assistant',
    content: [...prefix, { type: 'tool_use', id: 'same-id', name: 'lookup', input }],
    stop_reason: reason,
    usage: { input_tokens: 11, output_tokens: 7 },
  };
  return {
    final,
    events: [
      {
        type: 'message_start',
        message: {
          ...final,
          content: [],
          stop_reason: '',
          usage: { input_tokens: 11, output_tokens: 1 },
        },
      },
      ...prefix.flatMap((content_block, i) => [
        { type: 'content_block_start', index: i, content_block },
        stopTool(i),
      ]),
      startTool(index),
      ...parts.map((part) => fragment(index, part)),
      ...(closed ? [stopTool(index)] : []),
      ...(stopped ? terminal(reason) : []),
    ],
  };
}

function wireResponse(value: Fixture, bare = false): Response {
  const text = value.events
    .map((event) => `${bare ? '' : `event: ${event.type}\n`}data: ${JSON.stringify(event)}\n\n`)
    .join('');
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset < bytes.length) {
          const end = Math.min(offset + 7, bytes.length);
          controller.enqueue(bytes.slice(offset, end));
          offset = end;
        } else if (value.abort) controller.error(value.abort);
        else controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function providerFor(mode: 'sdk' | 'browser', value: Fixture) {
  if (mode === 'sdk') {
    const client = {
      messages: {
        create: vi.fn(async () => structuredClone(value.final)),
        stream: vi.fn(() => ({
          async *[Symbol.asyncIterator]() {
            for (const event of value.events) yield structuredClone(event);
            if (value.abort) throw value.abort;
          },
          finalMessage: vi.fn(async () => structuredClone(value.final)),
        })),
      },
    };
    return { provider: anthropic({ _client: client }), sent: client.messages.stream };
  }
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { stream?: boolean };
    return body.stream
      ? wireResponse(value)
      : new Response(JSON.stringify(value.final), {
          headers: { 'content-type': 'application/json' },
        });
  });
  return {
    provider: browserAnthropic({ apiKey: 'offline-placeholder', _fetch: fetch }),
    sent: fetch,
  };
}

async function drain(
  provider: LLMProvider,
  req = request,
  chunks: LLMChunk[] = [],
): Promise<LLMResponse> {
  for await (const chunk of provider.stream!(req)) chunks.push(chunk);
  const terminalChunks = chunks.filter((chunk) => chunk.done);
  expect(terminalChunks).toHaveLength(1);
  const response = terminalChunks[0]?.response;
  expect(response).toBeDefined();
  return response!;
}

function gateway(value: Fixture) {
  const fetch = vi.fn(async () => wireResponse(value, true));
  return {
    provider: invokeModelGateway({
      baseUrl: 'https://gateway.example.test/bedrock',
      apiKeyHeader: 'api-key',
      apiKey: 'offline-placeholder',
      fetch,
    }),
    sent: fetch,
  };
}

describe.each(['sdk', 'browser'] as const)('%s streamed tool argument integrity', (mode) => {
  it('does not invent invalid arguments from an unknown additive delta', async () => {
    const value = fixture({ parts: ['{"extra":true}'], input: { extra: true } });
    value.events.splice(3, 0, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'future_informational_delta' },
    });
    const response = await drain(providerFor(mode, value).provider);
    expect(response.toolCalls).toStrictEqual([
      { id: 'same-id', name: 'lookup', args: { extra: true } },
    ]);
  });
  it.each([
    ['explicit empty JSON', ['{', '}']],
    ['complete no-delta empty input', []],
  ] as const)('keeps %s valid without adding a failure field', async (_name, parts) => {
    const s = providerFor(mode, fixture({ parts: [...parts] }));
    const response = await drain(s.provider);
    expect(response.toolCalls).toStrictEqual([{ id: 'same-id', name: 'lookup', args: {} }]);
    expect(response.replay?.lossy).not.toBe(true);
    expect(response.replay?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(s.sent).toHaveBeenCalledTimes(1);
  });

  it('does not mistake valid extra argument members for protocol metadata', async () => {
    const input = {
      service: 'café',
      extra: 1,
      argumentsFailure: { reason: 'invalid-json' },
      cache_control: 'user-data',
    };
    const raw = JSON.stringify(input);
    const s = providerFor(mode, fixture({ parts: [raw.slice(0, 13), raw.slice(13)], input }));
    const response = await drain(s.provider);
    expect(response.toolCalls).toStrictEqual([{ id: 'same-id', name: 'lookup', args: input }]);
    expect(response.replay?.lossy).not.toBe(true);
  });

  it.each([
    ['invalid syntax repaired to empty', '{private-raw-fragment', {}],
    ['truncated JSON repaired to empty', '{"service":', {}],
    ['truncated JSON repaired to nonempty', '{"service":"search"', { service: 'search' }],
  ] as const)(
    'marks %s from observed fragments, without retaining raw JSON',
    async (_name, raw, input) => {
      const s = providerFor(mode, fixture({ parts: [raw], input: { ...input } }));
      const response = await drain(s.provider);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]).toMatchObject({
        id: 'same-id',
        name: 'lookup',
        argumentsFailure: { reason: 'invalid-json' },
      });
      expect(Object.keys(response.toolCalls[0]!).sort()).toEqual([
        'args',
        'argumentsFailure',
        'id',
        'name',
      ]);
      expect(
        (response.toolCalls[0] as { argumentsFailure?: unknown }).argumentsFailure,
      ).toStrictEqual({ reason: 'invalid-json' });
      expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
      expect(JSON.stringify(response)).not.toContain('private-raw-fragment');
      expect(s.sent).toHaveBeenCalledTimes(1);
    },
  );

  it('uses content-block positions for interleaved calls even when id and name repeat', async () => {
    const value = fixture();
    value.final.content = [
      { type: 'tool_use', id: 'same-id', name: 'lookup', input: {} },
      { type: 'text', text: 'Between calls.' },
      { type: 'tool_use', id: 'same-id', name: 'lookup', input: { extra: true } },
    ];
    value.events = [
      value.events[0]!,
      startTool(0),
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: 'Between calls.' },
      },
      startTool(2),
      fragment(0, '{broken'),
      fragment(2, '{"extra":'),
      fragment(2, 'true}'),
      stopTool(2),
      stopTool(1),
      stopTool(0),
      ...terminal(),
    ];
    const response = await drain(providerFor(mode, value).provider);
    expect(response.content).toBe('Between calls.');
    expect(response.toolCalls).toStrictEqual([
      { id: 'same-id', name: 'lookup', args: {}, argumentsFailure: { reason: 'invalid-json' } },
      { id: 'same-id', name: 'lookup', args: { extra: true } },
    ]);
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
  });

  it('does not carry a failure into a later response reusing the same id and index', async () => {
    const value = fixture({ parts: ['{broken'] });
    const s = providerFor(mode, value);
    expect((await drain(s.provider)).toolCalls[0]).toHaveProperty('argumentsFailure');
    Object.assign(value, fixture());
    expect((await drain(s.provider)).toolCalls).toStrictEqual([
      { id: 'same-id', name: 'lookup', args: {} },
    ]);
    expect(s.sent).toHaveBeenCalledTimes(2);
  });

  it('refuses an explicit empty argument delta instead of treating it as no delta', async () => {
    const response = await drain(providerFor(mode, fixture({ parts: [''] })).provider);
    expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
      reason: 'invalid-json',
    });
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
  });

  it('refuses a wrong-kind delta on a tool block instead of accepting no-delta empty input', async () => {
    const value = fixture({ parts: [] });
    value.events.splice(2, 0, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Not a tool argument fragment.' },
    });
    const response = await drain(providerFor(mode, value).provider);
    expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
      reason: 'incomplete-stream',
    });
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
  });

  it('refuses an orphan block stop before the later tool start', async () => {
    const value = fixture();
    value.events.splice(1, 0, stopTool(0));
    const response = await drain(providerFor(mode, value).provider);
    expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
      reason: 'incomplete-stream',
    });
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
  });

  it.each(['null', '[]', '"scalar"', '42'])(
    'refuses complete JSON %s that is not an argument object',
    async (raw) => {
      // SDK final input is deliberately not the authority: the observation of
      // complete non-object JSON must be enough even if a client repairs it.
      const response = await drain(providerFor(mode, fixture({ parts: [raw] })).provider);
      expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
        reason: 'invalid-argument-shape',
      });
      expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
    },
  );

  it.each(['late-fragment', 'duplicate-start', 'duplicate-stop'] as const)(
    'does not certify a tool block with %s',
    async (kind) => {
      const value = fixture();
      value.events = [
        value.events[0]!,
        startTool(0),
        fragment(0, '{}'),
        ...(kind === 'duplicate-start' ? [startTool(0), fragment(0, '{}')] : []),
        stopTool(0),
        ...(kind === 'late-fragment' ? [fragment(0, '{}')] : []),
        ...(kind === 'duplicate-stop' ? [stopTool(0)] : []),
        ...terminal(),
      ];
      const response = await drain(providerFor(mode, value).provider);
      expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
        reason: 'incomplete-stream',
      });
      expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
    },
  );

  it('returns a witnessed max_tokens completion with an invalid-json refusal marker', async () => {
    const s = providerFor(mode, fixture({ parts: ['{"service":'], reason: 'max_tokens' }));
    const response = await drain(s.provider);
    expect(response.stopReason).toBe('max_tokens');
    expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', { reason: 'invalid-json' });
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
  });

  it.each([
    ['unfinished partial JSON', ['{"service":']],
    ['no argument delta', []],
  ] as const)(
    'returns an incomplete-stream marker for a terminal max_tokens block with %s and no block stop',
    async (_name, parts) => {
      const response = await drain(
        providerFor(mode, fixture({ parts: [...parts], closed: false, reason: 'max_tokens' }))
          .provider,
      );
      expect(response.stopReason).toBe('max_tokens');
      expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
        reason: 'incomplete-stream',
      });
      expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
    },
  );

  it('leaves valid completed arguments unchanged when the terminal reason is max_tokens', async () => {
    const response = await drain(providerFor(mode, fixture({ reason: 'max_tokens' })).provider);
    expect(response.stopReason).toBe('max_tokens');
    expect(response.toolCalls).toStrictEqual([{ id: 'same-id', name: 'lookup', args: {} }]);
  });

  it('never yields a done response when an observed tool stream reaches EOF without message_stop', async () => {
    const chunks: LLMChunk[] = [];
    const value = fixture();
    value.events.pop(); // Keep message_delta; only the terminal witness is absent.
    const s = providerFor(mode, value);
    await expect(drain(s.provider, request, chunks)).rejects.toThrow();
    expect(chunks.some((chunk) => chunk.done || chunk.response !== undefined)).toBe(false);
    expect(s.sent).toHaveBeenCalledTimes(1);
  });

  it('never yields a done response after an aborted tool stream', async () => {
    const value = fixture({ parts: ['{"service":'], closed: false, stopped: false });
    value.abort = new Error('scripted stream aborted');
    const chunks: LLMChunk[] = [];
    const s = providerFor(mode, value);
    await expect(drain(s.provider, request, chunks)).rejects.toThrow(/scripted stream aborted/);
    expect(chunks.some((chunk) => chunk.done || chunk.response !== undefined)).toBe(false);
    expect(s.sent).toHaveBeenCalledTimes(1);
  });

  it('does not certify active signed-thinking replay after malformed tool arguments', async () => {
    const s = providerFor(mode, fixture({ parts: ['{broken'], thinking: true }));
    const response = await drain(s.provider);
    const assistant: LLMMessage = {
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
      replay: response.replay,
      thinkingBlocks: [
        { type: 'thinking', content: 'Signed local fixture.', signature: 'signature-unchanged' },
      ],
    };
    await expect(
      s.provider.complete({
        ...request,
        messages: [
          ...request.messages,
          assistant,
          { role: 'tool', toolCallId: 'same-id', content: 'The invalid call was not executed.' },
        ],
      }),
    ).rejects.toMatchObject({ name: 'UnsafeThinkingReplayError' });
    expect(s.sent).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { service: 'search', extra: true }])(
    'does not add streamed evidence to nonstream input %j',
    async (input) => {
      // Deliberately pair invalid scripted stream events with a valid complete()
      // message. complete() must never infer failure from input or an unused stream.
      const s = providerFor(mode, fixture({ parts: ['{broken'], input }));
      const response = await s.provider.complete(request);
      expect(response.toolCalls).toStrictEqual([{ id: 'same-id', name: 'lookup', args: input }]);
      expect(response.replay?.lossy).not.toBe(true);
    },
  );
});

describe('gateway compatibility controls', () => {
  it.each(['{broken', '{"service":'])(
    'preserves the stronger malformed refusal for %s',
    async (raw) => {
      const s = gateway(fixture({ parts: [raw] }));
      const chunks: LLMChunk[] = [];
      await expect(drain(s.provider, request, chunks)).rejects.toMatchObject({
        name: 'InvokeModelGatewayError',
        reason: 'malformed-tool-args',
        retryable: false,
        toolName: 'lookup',
      });
      expect(chunks.some((chunk) => chunk.done || chunk.response !== undefined)).toBe(false);
      expect(s.sent).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['explicit empty object', ['{}']],
    ['no delta', []],
  ] as const)('keeps a complete %s valid', async (_name, parts) => {
    const s = gateway(fixture({ parts: [...parts] }));
    const response = await drain(s.provider);
    expect(response.toolCalls).toStrictEqual([{ id: 'same-id', name: 'lookup', args: {} }]);
    expect(s.sent).toHaveBeenCalledTimes(1);
  });

  it('keeps its public malformed-error class identity', async () => {
    await expect(drain(gateway(fixture({ parts: ['{broken'] })).provider)).rejects.toBeInstanceOf(
      InvokeModelGatewayError,
    );
  });
});

describe('browser incomplete malformed-identity tool stream', () => {
  it.each([
    { type: 'tool_use', name: 'lookup', input: {} },
    { type: 'tool_use', id: 'call-without-name', input: {} },
  ])('never certifies EOF after a tool block with incomplete identity %j', async (block) => {
    const event = { type: 'content_block_start', index: 0, content_block: block };
    const fetch = vi.fn(
      async () => new Response(`event: content_block_start\ndata: ${JSON.stringify(event)}\n\n`),
    );
    const provider = browserAnthropic({ apiKey: 'offline-placeholder', _fetch: fetch });
    const chunks: LLMChunk[] = [];
    await expect(drain(provider, request, chunks)).rejects.toThrow(/without message_stop/);
    expect(chunks.some((chunk) => chunk.done || chunk.response !== undefined)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
