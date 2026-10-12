/** Standard inert Messages metadata is preserved, never treated as lost thinking. */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { AnthropicProvider } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { invokeModelGateway } from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import {
  fromAnthropicResponse,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicMessagesBody,
} from '../../../src/adapters/llm/anthropicMessagesWire.js';
import {
  omitAnthropicThinking,
  restoreAnthropicReplay,
} from '../../../src/adapters/llm/anthropicReplayLayout.js';
import { anthropicThinkingHandler } from '../../../src/thinking/AnthropicThinkingHandler.js';
import { keepKnownValues } from '../../../src/redaction/knownStrings.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../../src/adapters/types.js';

const MODEL = 'claude-haiku-4-5-20251001';
const variants = [
  { name: 'absent', text: {}, tool: {} },
  { name: 'null citations', text: { citations: null }, tool: {} },
  { name: 'empty citations', text: { citations: [] }, tool: {} },
  { name: 'direct caller', text: {}, tool: { caller: { type: 'direct' } } },
  { name: 'null toolset', text: {}, tool: { toolset_name: null } },
  {
    name: 'combined',
    text: { citations: null },
    tool: { caller: { type: 'direct' }, toolset_name: null },
  },
] as const;

function reply(variant: (typeof variants)[number] = variants[5]): AnthropicMessage {
  return {
    id: 'metadata-response',
    role: 'assistant',
    model: MODEL,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 8 },
    content: [
      { type: 'thinking', thinking: 'Check the item.', signature: 'exact-signature' },
      { type: 'text', text: 'Looking up.', ...variant.text },
      { type: 'tool_use', id: 'lookup-1', name: 'lookup', input: { id: 'item' }, ...variant.tool },
    ],
  };
}

function stored(response: LLMResponse): LLMMessage {
  return JSON.parse(
    JSON.stringify({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
      thinkingBlocks: anthropicThinkingHandler.normalize(response.rawThinking),
      replay: response.replay,
    }),
  ) as LLMMessage;
}

const initial: LLMRequest = {
  model: MODEL,
  thinking: { budget: 2048 },
  messages: [{ role: 'user', content: 'Look up this item.' }],
};
const continuation = (message: LLMMessage): LLMRequest => ({
  ...initial,
  messages: [
    ...initial.messages,
    message,
    { role: 'tool', toolCallId: 'lookup-1', content: 'found' },
  ],
});

/** Real start/delta/stop assembly; metadata arrives on starts, not invented at finalization. */
function streamBody(message: AnthropicMessage): string {
  const events: Record<string, unknown>[] = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
  ];
  for (const [index, block] of message.content.entries()) {
    const start =
      block.type === 'text'
        ? { ...block, text: '' }
        : block.type === 'thinking'
        ? { ...block, thinking: '', signature: '' }
        : block.type === 'tool_use'
        ? { ...block, input: {} }
        : block;
    events.push({ type: 'content_block_start', index, content_block: start });
    const deltas =
      block.type === 'text'
        ? [{ type: 'text_delta', text: block.text }]
        : block.type === 'thinking'
        ? [
            { type: 'thinking_delta', thinking: block.thinking },
            { type: 'signature_delta', signature: block.signature },
          ]
        : block.type === 'tool_use'
        ? [{ type: 'input_json_delta', partial_json: JSON.stringify(block.input) }]
        : [];
    for (const delta of deltas) events.push({ type: 'content_block_delta', index, delta });
    events.push({ type: 'content_block_stop', index });
  }
  events.push(
    { type: 'message_delta', delta: { stop_reason: message.stop_reason }, usage: message.usage },
    { type: 'message_stop' },
  );
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function harness(kind: string, mode: string, first = reply()) {
  const bodies: AnthropicMessagesBody[] = [];
  const final: AnthropicMessage = {
    ...first,
    id: 'final-response',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Found the item.' }],
  };
  const respond = (body: AnthropicMessagesBody) => {
    bodies.push(JSON.parse(JSON.stringify(body)) as AnthropicMessagesBody);
    if (bodies.length > 2) throw new Error('Fixture exhausted');
    return bodies.length === 1 ? first : final;
  };
  const client = {
    messages: {
      create: async (body: AnthropicMessagesBody) => respond(body),
      stream: (body: AnthropicMessagesBody) => {
        const result = respond(body);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_stop' };
          },
          async finalMessage() {
            return result;
          },
        };
      },
    },
  };
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const result = respond(JSON.parse(String(init?.body)) as AnthropicMessagesBody);
    return new Response(mode === 'complete' ? JSON.stringify(result) : streamBody(result));
  };
  const provider =
    kind === 'sdk'
      ? new AnthropicProvider({ _client: client })
      : kind === 'browser'
      ? browserAnthropic({ apiKey: 'synthetic-key', _fetch: fetch })
      : invokeModelGateway({
          baseUrl: 'https://gateway.invalid',
          apiKeyHeader: 'x-test-key',
          apiKey: async () => 'synthetic-key',
          fetch,
        });
  return { provider, bodies };
}

async function invoke(provider: LLMProvider, mode: string, request: LLMRequest) {
  if (mode === 'complete') return provider.complete(request);
  let response: LLMResponse | undefined;
  for await (const chunk of provider.stream!(request))
    if (chunk.response) response = chunk.response;
  if (!response) throw new Error('No final stream response');
  return response;
}

describe.each(['sdk', 'browser', 'gateway'])('%s standard response metadata', (kind) => {
  describe.each(['complete', 'stream'])('%s', (mode) => {
    it.each(variants)('replays $name exactly after JSON persistence', async (variant) => {
      const original = reply(variant);
      const h = harness(kind, mode, original);
      const response = await invoke(h.provider, mode, initial);
      expect(response.replay?.lossy).toBeUndefined();
      expect(response.replay?.layout).toEqual([
        { type: 'thinking', index: 0 },
        { type: 'text', length: 11, ...variant.text },
        { type: 'tool', index: 0, ...variant.tool },
      ]);
      const persisted = stored(response);
      expect(restoreAnthropicReplay(persisted)).toEqual(original.content);
      await invoke(h.provider, mode, continuation(persisted));
      expect(h.bodies).toHaveLength(2);
      expect(h.bodies[1].messages[1]).toEqual({ role: 'assistant', content: original.content });
      expect(h.bodies[1].messages[2]).toEqual({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'lookup-1', content: 'found' }],
      });
    });
  });
});

describe('sparse metadata fidelity guards', () => {
  it('retains only inert metadata, and retirement preserves the same remaining blocks', () => {
    const response = fromAnthropicResponse(reply());
    expect(response.replay?.lossy).toBeUndefined();
    const metadata = JSON.stringify(response.replay);
    for (const value of ['Check the item.', 'exact-signature', 'Looking up.', 'lookup-1', 'item'])
      expect(metadata).not.toContain(value);
    const message = stored(response);
    expect(restoreAnthropicReplay(omitAnthropicThinking(message))).toEqual(
      reply().content.slice(1),
    );
    expect(keepKnownValues(message.replay)).toMatchObject({
      layout: [
        { type: 'thinking', index: 0 },
        { type: 'text', length: 11, citations: null },
        { type: 'tool', index: 0, caller: { type: 'direct' }, toolset_name: null },
      ],
    });
  });

  it.each([
    ['remove citations', 1, 'citations', undefined],
    ['change null to empty citations', 1, 'citations', []],
    ['add citation content', 1, 'citations', [{ type: 'page_location', cited_text: 'changed' }]],
    ['remove direct caller', 2, 'caller', undefined],
    ['change caller', 2, 'caller', { type: 'code_execution_20250825', tool_id: 'server' }],
    ['add caller field', 2, 'caller', { type: 'direct', extra: true }],
    ['remove null toolset', 2, 'toolset_name', undefined],
    ['name a toolset', 2, 'toolset_name', 'tools'],
    ['add unknown metadata', 1, 'unknown', true],
  ] as const)('refuses %s before a second transport', async (_name, index, key, value) => {
    const h = harness('sdk', 'complete');
    const message = stored(await h.provider.complete(initial));
    expect(message.replay?.lossy).toBeUndefined();
    // Deliberately corrupt caller-owned JSON, not the typed public carrier.
    const changed = JSON.parse(JSON.stringify(message));
    if (value === undefined) delete changed.replay.layout[index][key];
    else changed.replay.layout[index][key] = value;
    expect(restoreAnthropicReplay(changed)).toBeUndefined();
    await expect(h.provider.complete(continuation(changed))).rejects.toMatchObject({
      name: 'UnsafeThinkingReplayError',
      reason: 'content-changed',
    });
    expect(h.bodies).toHaveLength(1);
  });

  it.each([
    { type: 'text', text: 'x', citations: [{ type: 'page_location' }] },
    { type: 'text', text: 'x', citations: undefined },
    { type: 'text', text: 'x', unknown: true },
    { type: 'tool_use', id: 't', name: 'lookup', input: {}, caller: null },
    {
      type: 'tool_use',
      id: 't',
      name: 'lookup',
      input: {},
      caller: { type: 'direct', extra: true },
    },
    {
      type: 'tool_use',
      id: 't',
      name: 'lookup',
      input: {},
      caller: { type: 'code_execution_20250825' },
    },
    { type: 'tool_use', id: 't', name: 'lookup', input: {}, toolset_name: 'named' },
    { type: 'tool_use', id: 't', name: 'lookup', input: {}, toolset_name: undefined },
  ])('keeps unsupported wire fields lossy: %j', (unsupported) => {
    const original = reply();
    // A provider is untrusted at runtime; these are intentionally outside the supported wire type.
    original.content = [original.content[0], unsupported as AnthropicContentBlock];
    const response = fromAnthropicResponse(original);
    expect(response.replay?.lossy).toBe(true);
    expect(restoreAnthropicReplay(stored(response))).toBeUndefined();
  });
});

describe.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
  'public Agent metadata replay (%s)',
  (reactMode) => {
    it.each(['complete', 'stream'])(
      'finishes a %s tool turn and keeps exact sparse evidence in a JSON checkpoint',
      async (mode) => {
        const h = harness('sdk', mode);
        // The public provider contract makes streaming optional. A complete-only
        // delegate exercises the actual adapter's complete() through the same runner.
        const provider: LLMProvider =
          mode === 'stream'
            ? h.provider
            : {
                name: h.provider.name,
                complete: h.provider.complete.bind(h.provider),
                thinkingHandler: h.provider.thinkingHandler,
                thinkingMode: h.provider.thinkingMode,
              };
        const lookup = defineTool({
          name: 'lookup',
          description: 'Read one item.',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          execute: async () => 'found',
        });
        const agent = Agent.create({ provider, model: MODEL, maxIterations: 3, reactMode })
          .system('Use the lookup tool, then answer.')
          .tool(lookup)
          .thinking({ budget: 2048 })
          .build();
        const result = await agent.run({ message: 'Look up this item.' });
        expect(result).toBe('Found the item.');
        expect(h.bodies).toHaveLength(2);
        expect(
          h.bodies[1].messages.find((message) => message.role === 'assistant')?.content,
        ).toEqual(reply().content);
        const checkpoint = JSON.parse(JSON.stringify(agent.checkpoint()));
        const saved = checkpoint.history.find(
          (message: LLMMessage) => message.replay?.id === 'metadata-response',
        );
        expect(restoreAnthropicReplay(saved)).toEqual(reply().content);
      },
    );
  },
);
