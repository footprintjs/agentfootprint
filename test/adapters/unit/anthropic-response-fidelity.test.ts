/** Actual response block order survives normalization and JSON history storage. */
import { describe, expect, it, vi } from 'vitest';
import {
  assembleAnthropicStream,
  fromAnthropicResponse,
  toAnthropicMessages,
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicStreamEvent,
} from '../../../src/adapters/llm/anthropicMessagesWire.js';
import { AnthropicProvider } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { prepareAnthropicReplay } from '../../../src/adapters/llm/anthropicThinkingReplay.js';
import { anthropicThinkingHandler } from '../../../src/thinking/AnthropicThinkingHandler.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';
import {
  captureAnthropicReplay,
  omitAnthropicThinking,
  replayDigest,
  restoreAnthropicReplay,
} from '../../../src/adapters/llm/anthropicReplayLayout.js';

const ordered: AnthropicContentBlock[] = [
  { type: 'text', text: 'Before 🧭' },
  { type: 'thinking', thinking: 'reason\n', signature: ' sig\u0000' },
  { type: 'tool_use', id: 't1', name: 'read', input: { key: 'one' } },
  { type: 'text', text: '' },
  { type: 'redacted_thinking', data: 'sealed\n' },
  { type: 'text', text: 'after' },
  { type: 'tool_use', id: 't2', name: 'read', input: { key: 'two' } },
];

function reply(content: AnthropicContentBlock[] = ordered): AnthropicMessage {
  return {
    id: 'msg_ordered',
    model: 'claude-sonnet-4-6',
    role: 'assistant',
    content,
    stop_reason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 11, output_tokens: 7 },
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

async function* events(): AsyncIterable<AnthropicStreamEvent> {
  yield { event: 'message_start', data: { message: { ...reply([]), content: [] } } };
  // Starts and stops are deliberately interleaved: original indices, not
  // completion timing, own the durable response's ordering.
  for (const [index, block] of ordered.entries()) {
    const initial =
      block.type === 'text'
        ? { type: 'text', text: '' }
        : block.type === 'thinking'
        ? { type: 'thinking', thinking: '' }
        : block.type === 'tool_use'
        ? { ...block, input: {} }
        : block;
    yield { event: 'content_block_start', data: { index, content_block: initial } };
  }
  for (const index of [6, 5, 4, 3, 2, 1, 0]) {
    const block = ordered[index]!;
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
    for (const delta of deltas) yield { event: 'content_block_delta', data: { index, delta } };
    yield { event: 'content_block_stop', data: { index } };
  }
  yield {
    event: 'message_delta',
    data: { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
  };
  yield { event: 'message_stop', data: {} };
}

describe('Anthropic response fidelity', () => {
  it('stores only lengths, indices and digests, not another content copy', () => {
    const response = fromAnthropicResponse(reply());
    expect(response.replay?.layout).toEqual([
      { type: 'text', length: 9 },
      { type: 'thinking', index: 0 },
      { type: 'tool', index: 0 },
      { type: 'text', length: 0 },
      { type: 'thinking', index: 1 },
      { type: 'text', length: 5 },
      { type: 'tool', index: 1 },
    ]);
    const metadata = JSON.stringify(response.replay);
    for (const secret of ['Before', 'reason', 'sealed', 'one', 'two', 'sig'])
      expect(metadata).not.toContain(secret);
    expect(response.rawThinking).toBe(reply().content);
  });

  it.each([
    ['text edit', (message: LLMMessage) => ({ ...message, content: 'changed' })],
    [
      'tool edit',
      (message: LLMMessage) => ({
        ...message,
        toolCalls: [
          { id: 't1', name: 'read', args: { key: 'changed' } },
          ...message.toolCalls!.slice(1),
        ],
      }),
    ],
    [
      'signature edit',
      (message: LLMMessage) => ({
        ...message,
        thinkingBlocks: message.thinkingBlocks!.map((block, index) =>
          index === 0 ? { ...block, signature: 'changed' } : block,
        ),
      }),
    ],
    [
      'extra thinking',
      (message: LLMMessage) => ({
        ...message,
        thinkingBlocks: [
          ...message.thinkingBlocks!,
          { type: 'thinking' as const, content: 'extra', signature: 'extra' },
        ],
      }),
    ],
    [
      'removed tool',
      (message: LLMMessage) => ({ ...message, toolCalls: message.toolCalls!.slice(1) }),
    ],
    [
      'retired thinking',
      (message: LLMMessage) => ({
        ...message,
        replay: { ...message.replay!, thinkingRetired: true as const },
      }),
    ],
  ])('does not silently recover original content after %s', (_name, alter) => {
    const message = stored(fromAnthropicResponse(reply()));
    expect(restoreAnthropicReplay(alter(message))).toBeUndefined();
    expect(restoreAnthropicReplay(message)).toEqual(ordered);
  });

  it.each([
    [{ type: 'text', length: -1 }],
    [{ type: 'text', length: 1.5 }],
    [{ type: 'text', length: Number.MAX_SAFE_INTEGER }],
    [{ type: 'thinking', index: 1 }],
    [{ type: 'tool', index: 1 }],
    [{ type: 'unknown', index: 0 }],
    [null],
    [],
  ])('rejects malformed/incomplete saved layouts: %j', (part) => {
    const message = stored(fromAnthropicResponse(reply()));
    const broken = { ...message, replay: { ...message.replay!, layout: [part] } };
    expect(restoreAnthropicReplay(broken as LLMMessage)).toBeUndefined();
  });

  it('does not certify unknown blocks, extra response fields, missing ids or non-JSON arguments', () => {
    expect(captureAnthropicReplay(ordered, '', 'tool_use')).toBeUndefined();
    const unsupported = [
      { type: 'server_tool_use', id: 'server' },
      { type: 'text', text: 'citation', citations: [{ source: 'url' }] },
      { type: 'tool_use', id: 'bigint', name: 'read', input: { amount: 1n } },
    ];
    for (const block of unsupported) {
      expect(
        captureAnthropicReplay([block] as AnthropicContentBlock[], 'msg', 'stop'),
      ).toBeUndefined();
    }
  });

  it('leaves legacy text-only responses with no identity unknown, not falsely lossy', () => {
    const response = fromAnthropicResponse({
      ...reply([{ type: 'text', text: 'legacy' }]),
      id: '',
    });
    expect(response.replay).toBeUndefined();
    expect(response.providerRef).toBeUndefined();
  });

  it('uses the same salted canonical digest for capture and JSON-restored validation', () => {
    const binding = {
      model: 'claude-sonnet-4-6',
      salt: 'actual-response-id',
      system: 'system-digest',
      tools: 'tools-digest',
      messages: 'messages-digest',
      priorThinking: [],
    };
    const response = fromAnthropicResponse(reply(), binding);
    expect(response.replay?.contentDigest).toBe(replayDigest(ordered, binding.salt));
    expect(restoreAnthropicReplay(stored(response))).toEqual(ordered);
    expect(replayDigest({ a: 1, b: 2 }, 's')).toBe(replayDigest({ b: 2, a: 1 }, 's'));
    expect(replayDigest(JSON.parse('{"__proto__":{"private":true}}'), 's')).not.toBe(
      replayDigest({}, 's'),
    );
  });

  it('retires only thinking while retaining text/tool order through JSON restore', () => {
    const message = stored(fromAnthropicResponse(reply()));
    const omitted = omitAnthropicThinking(message);
    const persisted = JSON.parse(JSON.stringify(omitted)) as LLMMessage;
    expect(persisted.thinkingBlocks).toBeUndefined();
    expect(persisted.replay?.thinkingRetired).toBe(true);
    expect(toAnthropicMessages([persisted])[0]?.content).toEqual(
      ordered.filter((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking'),
    );
    expect(omitAnthropicThinking(persisted)).toEqual(persisted);
    expect(message.thinkingBlocks).toHaveLength(2);
    expect(
      restoreAnthropicReplay({ ...persisted, thinkingBlocks: message.thinkingBlocks }),
    ).toBeUndefined();
  });

  it('retirement cannot resurrect edited text or tools from a stale layout', () => {
    const changed = {
      ...stored(fromAnthropicResponse(reply())),
      content: 'edited final answer',
      toolCalls: [],
    };
    const omitted = omitAnthropicThinking(changed);
    expect(toAnthropicMessages([omitted])[0]?.content).toEqual([
      { type: 'text', text: 'edited final answer' },
    ]);
    expect(omitted.replay?.thinkingRetired).toBe(true);
    expect(
      omitAnthropicThinking({
        role: 'assistant',
        content: 'legacy',
        thinkingBlocks: [{ type: 'thinking', content: 'old' }],
      }),
    ).toEqual({ role: 'assistant', content: 'legacy' });
  });

  it('retires changed signatures while preserving the current interleaved text/tool layout', () => {
    const original = stored(fromAnthropicResponse(reply()));
    const changed = {
      ...original,
      // Equal-length replacement demonstrates current values, not old content,
      // own the new layout; a signature edit makes the old digest invalid.
      content: original.content.replace('Before', 'Edited'),
      thinkingBlocks: original.thinkingBlocks!.map((block) => ({ ...block, signature: 'edited' })),
    };
    expect(restoreAnthropicReplay(changed)).toBeUndefined();
    const omitted = omitAnthropicThinking(changed);
    expect(restoreAnthropicReplay(omitted)).toEqual(
      ordered
        .filter((block) => block.type !== 'thinking' && block.type !== 'redacted_thinking')
        .map((block) =>
          block.type === 'text'
            ? { ...block, text: block.text.replace('Before', 'Edited') }
            : block,
        ),
    );
    expect(omitted.content).not.toContain('Before');
    expect(original.content).toContain('Before');
  });

  it('replays the complete response in its original mixed order after JSON restore', () => {
    const response = fromAnthropicResponse(reply());
    expect(toAnthropicMessages([stored(response)])[0]?.content).toEqual(ordered);
  });

  it('retains terminal text segmentation even without any thinking block', () => {
    const content: AnthropicContentBlock[] = [
      { type: 'text', text: 'one' },
      { type: 'text', text: '' },
      { type: 'text', text: 'two' },
    ];
    expect(
      toAnthropicMessages([stored(fromAnthropicResponse(reply(content)))])[0]?.content,
    ).toEqual(content);
  });

  it('assembles indexed stream blocks independently of their completion order', async () => {
    const chunks = [];
    for await (const chunk of assembleAnthropicStream(events(), {
      wireManifest: { toolNames: [] },
      onMalformedToolArgs: () => {
        throw new Error('unexpected malformed tool');
      },
    }))
      chunks.push(chunk);
    const response = chunks.at(-1)?.response;
    expect(response).toBeDefined();
    expect(response?.content).toBe('Before 🧭after');
    expect(response?.rawThinking).toEqual(ordered);
    expect(toAnthropicMessages([stored(response!)])[0]?.content).toEqual(ordered);
    // Streaming tokens still reflect arrival order, not delayed reordering.
    expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.content)).toEqual([
      'after',
      'Before 🧭',
    ]);
  });

  it.each(['message_start', 'message_delta', 'content_block_stop'])(
    'does not certify an incomplete stream missing %s',
    async (missing) => {
      async function* incomplete(): AsyncIterable<AnthropicStreamEvent> {
        for await (const event of events()) if (event.event !== missing) yield event;
      }
      let response: LLMResponse | undefined;
      for await (const chunk of assembleAnthropicStream(incomplete(), {
        wireManifest: { toolNames: [] },
        onMalformedToolArgs: () => ({}),
      }))
        if (chunk.response) response = chunk.response;
      expect(response).toBeDefined();
      expect(response?.replay).toMatchObject({ lossy: true, contentDigest: '' });
      expect(restoreAnthropicReplay(stored(response!))).toBeUndefined();
      if (missing === 'message_delta') expect(response?.replay?.stopReason).toBe('');
    },
  );

  it('rejects an incomplete tool stream missing message_stop without yielding a done response', async () => {
    async function* incomplete(): AsyncIterable<AnthropicStreamEvent> {
      for await (const event of events()) if (event.event !== 'message_stop') yield event;
    }
    let hasTerminalResponse = false;
    const collect = async () => {
      for await (const chunk of assembleAnthropicStream(incomplete(), {
        wireManifest: { toolNames: [] },
        onMalformedToolArgs: () => ({}),
      }))
        hasTerminalResponse ||= chunk.done || chunk.response !== undefined;
    };
    await expect(collect()).rejects.toThrow(/without message_stop/);
    expect(hasTerminalResponse).toBe(false);
  });

  it('keeps unindexed legacy stream text without inventing a replay proof', async () => {
    async function* unindexed(): AsyncIterable<AnthropicStreamEvent> {
      yield {
        event: 'content_block_delta',
        data: { delta: { type: 'text_delta', text: 'hello' } },
      };
      yield {
        event: 'content_block_delta',
        data: { delta: { type: 'text_delta', text: ' world' } },
      };
    }
    let response: LLMResponse | undefined;
    for await (const chunk of assembleAnthropicStream(unindexed(), {
      wireManifest: { toolNames: [] },
      onMalformedToolArgs: () => ({}),
    }))
      if (chunk.response) response = chunk.response;
    expect(response?.content).toBe('hello world');
    expect(response?.replay).toMatchObject({ lossy: true, id: '', stopReason: '', layout: [] });
    expect(response?.providerRef).toBeUndefined();
  });

  describe.each([
    ['thinking_delta', 0],
    ['signature_delta', 0],
    ['thinking_delta', undefined],
    ['signature_delta', undefined],
  ] as const)('witnessed orphan %s at index %s', (type, index) => {
    async function orphanResponse(): Promise<LLMResponse> {
      async function* orphan(): AsyncIterable<AnthropicStreamEvent> {
        yield { event: 'message_start', data: { message: reply([]) } };
        yield {
          event: 'content_block_delta',
          data: { index, delta: { type, thinking: 'not-retained', signature: 'not-retained' } },
        };
        yield {
          event: 'content_block_start',
          data: {
            index: 1,
            content_block: { type: 'tool_use', id: 't1', name: 'read', input: {} },
          },
        };
        yield { event: 'content_block_stop', data: { index: 1 } };
        yield { event: 'message_delta', data: { delta: { stop_reason: 'tool_use' } } };
        yield { event: 'message_stop', data: {} };
      }
      for await (const chunk of assembleAnthropicStream(orphan(), {
        wireManifest: { toolNames: [] },
        onMalformedToolArgs: () => ({}),
      }))
        if (chunk.response) return chunk.response;
      throw new Error('Missing terminal response');
    }

    it.each(['complete', 'stream'] as const)(
      'refuses active next %s before transport without fabricating a recovered block',
      async (mode) => {
        const response = await orphanResponse();
        expect(response.rawThinking).toBeUndefined();
        expect(response.replay).toMatchObject({
          lossy: true,
          contentDigest: '',
          layout: [{ type: 'thinking', index: 0 }],
        });
        expect(JSON.stringify(response)).not.toContain('not-retained');
        const fetchImpl = vi.fn(async () => {
          throw new Error('Unexpected transport');
        });
        const provider = browserAnthropic({ apiKey: 'offline', _fetch: fetchImpl });
        const req: LLMRequest = {
          model: 'claude-sonnet-4-6',
          messages: [stored(response), { role: 'tool', toolCallId: 't1', content: 'result' }],
        };
        const invoke = async () => {
          if (mode === 'complete') return provider.complete(req);
          for await (const _chunk of provider.stream!(req)) {
            /* exhaust the offline stream */
          }
        };
        await expect(invoke()).rejects.toMatchObject({
          name: 'UnsafeThinkingReplayError',
          reason: 'content-changed',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );

    it('does not invent an omission for absent blocks after witnessed completion', async () => {
      const response = await orphanResponse();
      const req: LLMRequest = {
        model: 'claude-sonnet-4-6',
        messages: [
          stored(response),
          { role: 'tool', toolCallId: 't1', content: 'result' },
          stored(
            fromAnthropicResponse({ ...reply([{ type: 'text', text: 'finished' }]), id: 'end' }),
          ),
          { role: 'user', content: 'next turn' },
        ],
      };
      const preparation = prepareAnthropicReplay(req, req.model, 'test');
      expect(preparation.request).toBe(req);
      expect(preparation.omissions).toEqual([]);
      expect(req.messages[0]?.replay?.lossy).toBe(true);
      expect(req.messages[0]?.thinkingBlocks).toEqual([]);
    });
  });

  it('does not claim malformed arguments repaired by a transport are the original response', async () => {
    async function* malformed(): AsyncIterable<AnthropicStreamEvent> {
      for await (const event of events()) {
        const data = event.data as { delta?: { type?: string } };
        yield data.delta?.type === 'input_json_delta'
          ? {
              ...event,
              data: { ...data, delta: { type: 'input_json_delta', partial_json: '{broken' } },
            }
          : event;
      }
    }
    const repair = vi.fn(() => ({}));
    let response: LLMResponse | undefined;
    for await (const chunk of assembleAnthropicStream(malformed(), {
      wireManifest: { toolNames: [] },
      onMalformedToolArgs: repair,
    }))
      if (chunk.response) response = chunk.response;
    expect(repair).toHaveBeenCalledTimes(2);
    expect(response?.toolCalls?.map((call) => call.args)).toEqual([{}, {}]);
    expect(response?.replay).toMatchObject({ lossy: true, contentDigest: '' });
    expect(restoreAnthropicReplay(stored(response!))).toBeUndefined();
  });

  it('passes the real streamed response identity to capture binding once', async () => {
    const binding = {
      model: 'claude-sonnet-4-6',
      salt: 'response-salt',
      system: 's',
      tools: 't',
      messages: 'm',
      priorThinking: [],
    };
    const bindingFactory = vi.fn(() => binding);
    let response: LLMResponse | undefined;
    for await (const chunk of assembleAnthropicStream(events(), {
      wireManifest: { toolNames: [] },
      onMalformedToolArgs: () => ({}),
      bindingFactory,
    }))
      if (chunk.response) response = chunk.response;
    expect(bindingFactory).toHaveBeenCalledExactlyOnceWith('msg_ordered');
    expect(response?.replay?.binding).toBe(binding);
    expect(restoreAnthropicReplay(stored(response!))).toEqual(ordered);
  });

  it.each(['complete', 'stream'] as const)(
    'SDK %s uses the same response conversion',
    async (mode) => {
      const sdk = {
        messages: {
          create: vi.fn(async () => reply()),
          stream: vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
              for await (const event of events()) {
                yield { ...(event.data as Record<string, unknown>), type: event.event };
              }
            },
            async finalMessage() {
              return reply();
            },
          })),
        },
      };
      const provider = new AnthropicProvider({ _client: sdk });
      const request = {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user' as const, content: 'test' }],
      };
      let response: LLMResponse | undefined;
      if (mode === 'complete') response = await provider.complete(request);
      else
        for await (const chunk of provider.stream(request))
          if (chunk.response) response = chunk.response;
      expect(toAnthropicMessages([stored(response!)])[0]?.content).toEqual(ordered);
    },
  );
});
