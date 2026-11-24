import { expect, it } from 'vitest';
import {
  observeCitationOffers,
  type CitationWireBody,
} from '../../provider-contract/requestObserver.js';
import type {
  LLMCallHooks,
  LLMMessage,
  LLMRequest,
  LLMResponse,
} from '../../provider-contract/types.js';
import { anthropicThinkingHandler } from '../../thinking/AnthropicThinkingHandler.js';
import { anthropic } from './AnthropicProvider.js';
import {
  buildMessagesBody,
  fromAnthropicResponse,
  type AnthropicMessage,
  type AnthropicMessagesBody,
} from './anthropicMessagesWire.js';
import { thinkingReplayBinding } from './anthropicThinkingReplay.js';

const first: LLMMessage = { role: 'tool', toolCallId: 'c1', content: '12 mm' };
const second: LLMMessage = { ...first };
const request: LLMRequest = {
  model: 'claude-sonnet-4-6',
  systemPrompt: 'Stable instruction.',
  cacheMarkers: [{ field: 'system', boundaryIndex: 0, ttl: 'short', reason: 'test' }],
  messages: [
    { role: 'user', content: 'Report the measurement.' },
    { role: 'system', content: 'Not submitted in the Messages array.' },
    first,
    {
      role: 'tool',
      toolCallId: 'rejected',
      content: 'Recovery text.',
      toolArgumentsFailure: { reason: 'invalid-json' },
    },
    second,
  ],
};

function scriptedSdk(abandon = false) {
  const requests: AnthropicMessagesBody[] = [];
  const replyText = '12 mm [c:offer:2]';
  const reply: AnthropicMessage = {
    id: 'accepted',
    model: request.model,
    role: 'assistant',
    content: [{ type: 'text', text: replyText }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 4, output_tokens: 3 },
  };
  const provider = anthropic({
    _client: {
      messages: {
        async create(params) {
          requests.push(params);
          return reply;
        },
        stream(params) {
          requests.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: replyText },
              };
              if (abandon) throw new Error('stream abandoned');
              yield { type: 'message_stop' };
            },
            async finalMessage() {
              return reply;
            },
          };
        },
      },
    },
  });
  return { requests, provider };
}

function offers() {
  const observed: (readonly CitationWireBody[])[] = [];
  const accepted: LLMResponse[] = [];
  const hooks = observeCitationOffers({}, (rows) => {
    observed.push(rows);
    return {
      instruction: 'Citation offer for this attempt.',
      accept: (response) => accepted.push(response),
    };
  });
  return { hooks, observed, accepted };
}

async function answer(
  mode: 'complete' | 'stream',
  provider: ReturnType<typeof anthropic>,
  input: LLMRequest,
  hooks?: LLMCallHooks,
) {
  if (mode === 'complete') return provider.complete(input, hooks);
  for await (const chunk of provider.stream!(input, hooks)) {
    if (chunk.done) return chunk.response;
  }
  throw new Error('no terminal response');
}

it.each(['complete', 'stream'] as const)(
  'binds exact submitted tool blocks on %s',
  async (mode) => {
    const { requests, provider } = scriptedSdk();
    const { hooks, observed, accepted } = offers();
    const response = await answer(mode, provider, request, hooks);

    expect(observed).toEqual([
      [
        { source: first, body: '12 mm', blockNumber: 1 },
        { source: second, body: '12 mm', blockNumber: 2 },
      ],
    ]);
    expect(observed[0][0].source).toBe(first);
    expect(observed[0][1].source).toBe(second);
    expect(requests[0].system).toEqual([
      { type: 'text', text: 'Stable instruction.', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Citation offer for this attempt.' },
    ]);
    expect(requests[0].messages).toMatchObject([
      { role: 'user', content: 'Report the measurement.' },
      {
        role: 'user',
        content: [
          { type: 'tool_result', content: '12 mm' },
          { type: 'tool_result', content: '12 mm' },
          { type: 'text', text: 'Recovery text.' },
        ],
      },
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(response);
  },
);

it.each(['complete', 'stream'] as const)(
  'leaves thinking request bytes alone on %s',
  async (mode) => {
    const { requests, provider } = scriptedSdk();
    const { hooks, observed, accepted } = offers();
    const thinkingRequest = { ...request, thinking: { budget: 2048 } };
    await answer(mode, provider, thinkingRequest);
    await answer(mode, provider, thinkingRequest, hooks);

    expect(requests[1]).toEqual(requests[0]);
    expect(observed).toEqual([]);
    expect(accepted).toEqual([]);
  },
);

it('does not bind an offer from an abandoned stream', async () => {
  const { provider } = scriptedSdk(true);
  const { hooks, observed, accepted } = offers();

  await expect(answer('stream', provider, request, hooks)).rejects.toThrow('stream abandoned');
  expect(observed).toHaveLength(1);
  expect(accepted).toEqual([]);
});

it('keeps an active signed prefix intact even if this call asks for no thinking', async () => {
  const { requests, provider } = scriptedSdk();
  const { hooks, observed, accepted } = offers();
  const prefix = { ...request, messages: request.messages.slice(0, 1) };
  const prefixBody = buildMessagesBody(prefix, {
    model: prefix.model,
    provider: 'anthropic',
    maxTokensDefault: 4096,
    thinkingMode: () => 'adaptive',
  });
  const prior = fromAnthropicResponse(
    {
      id: 'bound',
      model: prefix.model,
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Earlier reasoning', signature: 'signed' },
        { type: 'tool_use', id: 'c1', name: 'measure', input: {} },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    thinkingReplayBinding(prefixBody, prefix, prefix.model)('bound'),
  );
  const input: LLMRequest = {
    ...prefix,
    messages: [
      ...prefix.messages,
      {
        role: 'assistant',
        content: prior.content,
        toolCalls: prior.toolCalls,
        thinkingBlocks: anthropicThinkingHandler.normalize(prior.rawThinking),
        replay: prior.replay,
      },
      first,
    ],
  };

  await answer('complete', provider, input);
  await answer('complete', provider, input, hooks);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[1].messages[1].content).toMatchObject([
    { type: 'thinking', thinking: 'Earlier reasoning', signature: 'signed' },
    { type: 'tool_use', id: 'c1' },
  ]);
  expect(observed).toEqual([]);
  expect(accepted).toEqual([]);
});
