/**
 * Official Anthropic SDK, injected byte-stream fetch, public adapter and Agent.
 * No network, credentials, copied SDK parser, optional skips or repaired-input
 * inference. The first control pins what the SDK itself does to malformed JSON.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import {
  anthropic,
  type AnthropicProviderOptions,
} from '../../../src/adapters/llm/AnthropicProvider.js';
import type { LLMChunk, LLMProvider, LLMRequest } from '../../../src/provider-contract/types.js';
import type { Payloads } from '../../../src/events.js';

const MODEL = 'claude-haiku-4-5-20251001';
const RAW = '{private-invalid-tool-json';
const request: LLMRequest = {
  model: MODEL,
  messages: [{ role: 'user', content: 'Read the optional-argument lookup.' }],
  tools: [{ name: 'lookup', description: 'Read a local record.', inputSchema: { type: 'object' } }],
};
type WireEvent = Record<string, unknown> & { type: string };
type WireBlock = Record<string, unknown> & { type: string };
type WireBody = { messages: { role: string; content: string | WireBlock[] }[]; stream?: boolean };
interface Reply {
  events: WireEvent[];
  error?: Error;
}

function toolReply({
  raw = RAW,
  id = 'bad-call',
  reason = 'tool_use',
  stopped = true,
  closed = true,
}: {
  raw?: string | null;
  id?: string;
  reason?: string;
  stopped?: boolean;
  closed?: boolean;
} = {}): Reply {
  return {
    events: [
      {
        type: 'message_start',
        message: {
          id: `message-${id}`,
          type: 'message',
          role: 'assistant',
          model: MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id, name: 'lookup', input: {} },
      },
      ...(raw === null
        ? []
        : [
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'input_json_delta', partial_json: raw },
            },
          ]),
      ...(closed ? [{ type: 'content_block_stop', index: 0 }] : []),
      {
        type: 'message_delta',
        delta: { stop_reason: reason, stop_sequence: null },
        usage: { output_tokens: 7 },
      },
      ...(stopped ? [{ type: 'message_stop' }] : []),
    ],
  };
}

function finalReply(): Reply {
  return {
    events: [
      {
        type: 'message_start',
        message: {
          id: 'message-final',
          type: 'message',
          role: 'assistant',
          model: MODEL,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 30, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Recovered.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 4 },
      },
      { type: 'message_stop' },
    ],
  };
}

function responseFor(reply: Reply): Response {
  const bytes = new TextEncoder().encode(
    reply.events
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join(''),
  );
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset < bytes.length) {
          const next = Math.min(offset + 5, bytes.length);
          controller.enqueue(bytes.slice(offset, next));
          offset = next;
        } else if (reply.error) controller.error(reply.error);
        else controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream', 'request-id': 'offline-fixture' } },
  );
}

function setup(replies: Reply[], beforeSend?: (body: WireBody) => void) {
  const bodies: WireBody[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(new URL(req.url).hostname).toBe('anthropic.example.test');
    const body = JSON.parse(await req.text()) as WireBody;
    bodies.push(body);
    beforeSend?.(body);
    const next = replies[bodies.length - 1];
    if (!next) throw new Error('Unexpected offline transmission');
    return responseFor(next);
  });
  const client = new Anthropic({
    apiKey: 'offline-placeholder',
    baseURL: 'https://anthropic.example.test',
    maxRetries: 0,
    fetch,
  });
  // The adapter's optional-SDK duck type is deliberately narrower than the
  // installed SDK's complete message union. This is the real SDK instance.
  const provider = anthropic({
    _client: client as unknown as NonNullable<AnthropicProviderOptions['_client']>,
  });
  return { client, provider, bodies, fetch };
}

async function drain(provider: LLMProvider, chunks: LLMChunk[] = []) {
  for await (const chunk of provider.stream!(request)) chunks.push(chunk);
  const done = chunks.filter((chunk) => chunk.done);
  expect(done).toHaveLength(1);
  expect(done[0]?.response).toBeDefined();
  return done[0]!.response!;
}

function blocks(body: WireBody): WireBlock[] {
  return body.messages.flatMap((message) =>
    typeof message.content === 'string' ? [] : message.content,
  );
}

describe('official SDK streamed argument evidence', () => {
  it('pins the SDK repair independently, then refuses the same raw stream at the adapter', async () => {
    const sdk = setup([toolReply()]);
    const stream = sdk.client.messages.stream({
      model: MODEL,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Offline parser control.' }],
    });
    const observed: unknown[] = [];
    for await (const event of stream) observed.push(event);
    const final = await stream.finalMessage();
    expect(final.content).toStrictEqual([
      { type: 'tool_use', id: 'bad-call', name: 'lookup', input: {} },
    ]);
    expect(JSON.stringify(observed)).toContain(RAW);
    expect(sdk.fetch).toHaveBeenCalledTimes(1);

    const adapted = setup([toolReply()]);
    const response = await drain(adapted.provider);
    expect(response.toolCalls).toStrictEqual([
      { id: 'bad-call', name: 'lookup', args: {}, argumentsFailure: { reason: 'invalid-json' } },
    ]);
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
    expect(JSON.stringify(response)).not.toContain(RAW);
    expect(adapted.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['{}', null])('accepts valid complete empty arguments from raw %j', async (raw) => {
    const s = setup([toolReply({ raw })]);
    const response = await drain(s.provider);
    expect(response.toolCalls).toStrictEqual([{ id: 'bad-call', name: 'lookup', args: {} }]);
    expect(response.replay?.lossy).not.toBe(true);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['null', '[]', '"scalar"', '42'])(
    'refuses an actual SDK stream carrying non-object JSON %s',
    async (raw) => {
      const s = setup([toolReply({ raw })]);
      const response = await drain(s.provider);
      expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', {
        reason: 'invalid-argument-shape',
      });
      expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps a witnessed max_tokens response recoverable without accepting malformed arguments', async () => {
    const s = setup([toolReply({ raw: '{"service":', reason: 'max_tokens' })]);
    const response = await drain(s.provider);
    expect(response.stopReason).toBe('max_tokens');
    expect(response.toolCalls[0]).toHaveProperty('argumentsFailure', { reason: 'invalid-json' });
    expect(response.replay).toMatchObject({ lossy: true, contentDigest: '' });
  });

  it('does not yield a terminal response at EOF without message_stop', async () => {
    const s = setup([toolReply({ raw: '{}', stopped: false })]);
    const chunks: LLMChunk[] = [];
    await expect(drain(s.provider, chunks)).rejects.toThrow();
    expect(chunks.some((chunk) => chunk.done || chunk.response !== undefined)).toBe(false);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not yield a terminal response after a raw body read failure', async () => {
    const reply = toolReply({ stopped: false, closed: false });
    reply.error = new Error('offline body read aborted');
    const s = setup([reply]);
    const chunks: LLMChunk[] = [];
    await expect(drain(s.provider, chunks)).rejects.toThrow();
    expect(chunks.some((chunk) => chunk.done || chunk.response !== undefined)).toBe(false);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('official SDK + public Agent optional-argument recovery', () => {
  it('executes witnessed valid JSON despite an unknown additive tool delta', async () => {
    const reply = toolReply({ raw: '{"service":"checkout"}', id: 'future-delta-call' });
    reply.events.splice(3, 0, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'future_tool_annotation_delta', annotation: { opaque: true } },
    });
    const adapted = setup([reply]);
    const response = await drain(adapted.provider);
    expect(response.toolCalls).toStrictEqual([
      { id: 'future-delta-call', name: 'lookup', args: { service: 'checkout' } },
    ]);

    const execute = vi.fn((_args: Readonly<Record<string, unknown>>) => 'Local fixture result.');
    const s = setup([reply, finalReply()]);
    const agent = Agent.create({ provider: s.provider, model: MODEL, maxIterations: 3 })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Read a local record.',
          inputSchema: { type: 'object' },
          execute,
        }),
      )
      .build();
    await expect(agent.run({ message: 'Read the local record.' })).resolves.toBe('Recovered.');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ service: 'checkout' });
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(blocks(s.bodies[1]!).filter((block) => block.type === 'tool_use')).toEqual([
      expect.objectContaining({ id: 'future-delta-call', input: { service: 'checkout' } }),
    ]);
  });

  it.each(['tool_use', 'max_tokens'])(
    'refuses malformed %s arguments, then executes only a valid retry',
    async (reason) => {
      const execute = vi.fn((_args: Readonly<Record<string, unknown>>) => 'Local fixture result.');
      const executionsAtSend: number[] = [];
      const s = setup(
        [toolReply({ reason }), toolReply({ raw: '{}', id: 'good-call' }), finalReply()],
        () => executionsAtSend.push(execute.mock.calls.length),
      );
      const agent = Agent.create({ provider: s.provider, model: MODEL, maxIterations: 4 })
        .tool(
          defineTool({
            name: 'lookup',
            description: 'Read a local record.',
            inputSchema: { type: 'object' },
            execute,
          }),
        )
        .build();
      const ends: Payloads.ToolEndPayload[] = [];
      agent.on('agentfootprint.stream.tool_end', (event) => ends.push(event.payload));
      await expect(agent.run({ message: 'Read the optional-argument lookup.' })).resolves.toBe(
        'Recovered.',
      );
      expect(executionsAtSend).toEqual([0, 0, 1]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]?.[0]).toEqual({});
      expect(ends).toHaveLength(2);
      expect(ends[0]).toMatchObject({ toolCallId: 'bad-call', error: true });
      expect(ends[1]).toMatchObject({ toolCallId: 'good-call' });
      expect(ends[1]?.error).not.toBe(true);
      expect(s.fetch).toHaveBeenCalledTimes(3);

      // The malformed call is described honestly as text, not fabricated as a
      // successful tool_use with SDK-repaired {} and a linked tool_result.
      const retry = s.bodies[1]!;
      expect(
        blocks(retry).some((block) => block.type === 'tool_use' || block.type === 'tool_result'),
      ).toBe(false);
      expect(
        retry.messages.some(
          (message) =>
            message.role === 'assistant' &&
            (typeof message.content === 'string'
              ? message.content.length > 0
              : message.content.some((block) => block.type === 'text')),
        ),
      ).toBe(true);
      expect(
        retry.messages.some(
          (message) =>
            message.role === 'user' &&
            /invalid|malformed|incomplete|refused/i.test(JSON.stringify(message.content)),
        ),
      ).toBe(true);
      expect(JSON.stringify(s.bodies)).not.toContain(RAW);
      expect(JSON.stringify(s.bodies)).not.toContain('argumentsFailure');
      expect(blocks(s.bodies[2]!).filter((block) => block.type === 'tool_use')).toEqual([
        expect.objectContaining({ id: 'good-call', name: 'lookup', input: {} }),
      ]);
      expect(blocks(s.bodies[2]!).filter((block) => block.type === 'tool_result')).toEqual([
        expect.objectContaining({ tool_use_id: 'good-call' }),
      ]);
    },
  );

  it.each(['{}', null])(
    'executes complete valid empty raw %j once without a repair turn',
    async (raw) => {
      const execute = vi.fn((_args: Readonly<Record<string, unknown>>) => 'Local fixture result.');
      const s = setup([toolReply({ raw, id: 'valid-call' }), finalReply()]);
      const agent = Agent.create({ provider: s.provider, model: MODEL, maxIterations: 3 })
        .tool(
          defineTool({
            name: 'lookup',
            description: 'Read a local record.',
            inputSchema: { type: 'object' },
            execute,
          }),
        )
        .build();
      await expect(agent.run({ message: 'Read the local record.' })).resolves.toBe('Recovered.');
      expect(execute).toHaveBeenCalledTimes(1);
      expect(s.fetch).toHaveBeenCalledTimes(2);
      expect(blocks(s.bodies[1]!).filter((block) => block.type === 'tool_use')).toEqual([
        expect.objectContaining({ id: 'valid-call', input: {} }),
      ]);
    },
  );
});

describe('official SDK + public Agent mixed-batch recovery ordering', () => {
  it('places valid sibling results before recovery text without replaying refused tool IDs', async () => {
    const calls = [
      { id: 'bad-first', raw: RAW },
      { id: 'valid-middle', raw: '{}' },
      { id: 'bad-last', raw: '{"service":' },
    ];
    const mixed: Reply = {
      events: [
        toolReply().events[0]!,
        ...calls.flatMap((call, index): WireEvent[] => [
          {
            type: 'content_block_start',
            index,
            content_block: {
              type: 'tool_use',
              id: call.id,
              name: 'lookup',
              input: {},
            },
          },
          {
            type: 'content_block_delta',
            index,
            delta: {
              type: 'input_json_delta',
              partial_json: call.raw,
            },
          },
          { type: 'content_block_stop', index },
        ]),
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 9 },
        },
        { type: 'message_stop' },
      ],
    };
    const execute = vi.fn((_args: Readonly<Record<string, unknown>>) => 'Valid sibling result.');
    const executionsAtSend: number[] = [];
    const s = setup([mixed, finalReply()], () => executionsAtSend.push(execute.mock.calls.length));
    const agent = Agent.create({ provider: s.provider, model: MODEL, maxIterations: 3 })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Read a local record.',
          inputSchema: { type: 'object' },
          execute,
        }),
      )
      .build();
    const ends: Payloads.ToolEndPayload[] = [];
    agent.on('agentfootprint.stream.tool_end', (event) => ends.push(event.payload));
    await expect(agent.run({ message: 'Read the local records.' })).resolves.toBe('Recovered.');
    expect(executionsAtSend).toEqual([0, 1]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(ends).toMatchObject([
      { toolCallId: 'bad-first', error: true },
      { toolCallId: 'valid-middle' },
      { toolCallId: 'bad-last', error: true },
    ]);
    expect(ends[1]?.error).not.toBe(true);
    expect(s.fetch).toHaveBeenCalledTimes(2);
    const retry = s.bodies[1]!;
    const assistantIndex = retry.messages.findIndex((message) => message.role === 'assistant');
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    const followUpBlocks = retry.messages.slice(assistantIndex + 1).flatMap((message) => {
      expect(message.role).toBe('user');
      expect(Array.isArray(message.content)).toBe(true);
      return typeof message.content === 'string' ? [] : message.content;
    });
    expect(followUpBlocks.map((block) => block.type)).toEqual(['tool_result', 'text', 'text']);
    expect(
      blocks(retry)
        .filter((block) => block.type === 'tool_use')
        .map((block) => block.id),
    ).toEqual(['valid-middle']);
    expect(
      followUpBlocks
        .filter((block) => block.type === 'tool_result')
        .map((block) => block.tool_use_id),
    ).toEqual(['valid-middle']);
    expect(JSON.stringify(retry)).not.toContain(RAW);
    expect(JSON.stringify(retry)).not.toContain('argumentsFailure');
  });
});
