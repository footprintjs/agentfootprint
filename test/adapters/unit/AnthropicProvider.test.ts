/**
 * AnthropicProvider — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Uses an injected fake `_client` instead of a real Anthropic SDK.
 */

import { describe, expect, it, vi } from 'vitest';

import { anthropic, AnthropicProvider } from '../../../src/adapters/llm/AnthropicProvider.js';
import type { LLMRequest, LLMMessage } from '../../../src/adapters/types.js';
import { expectScalesLinearly } from '../../helpers/perf.js';

// ─── Fake Anthropic SDK shape ──────────────────────────────────────

interface FakeMessage {
  id: string;
  model: string;
  role: 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
  usage: { input_tokens: number; output_tokens: number };
}

function makeFakeClient(
  responses: FakeMessage[] | ((params: unknown) => FakeMessage),
  recorder?: { params: unknown[] },
) {
  let i = 0;
  return {
    messages: {
      create: vi.fn(async (params: unknown) => {
        recorder?.params.push(params);
        if (typeof responses === 'function') return responses(params);
        return responses[i++] ?? responses[responses.length - 1]!;
      }),
      stream: vi.fn((params: unknown) => {
        recorder?.params.push(params);
        const final =
          typeof responses === 'function'
            ? responses(params)
            : responses[i++] ?? responses[responses.length - 1]!;
        // SDK stream that yields one text-delta event per text block, then finalMessage().
        const textBlocks = final.content.filter((b) => b.type === 'text') as Array<{
          text: string;
        }>;
        const events = textBlocks.flatMap((b) =>
          b.text.split('').map((ch) => ({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ch },
          })),
        );
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of events) yield e;
          },
          async finalMessage() {
            return final;
          },
        };
      }),
    },
  };
}

const baseResponse: FakeMessage = {
  id: 'msg_1',
  model: 'claude-sonnet-4-5-20250929',
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 2 },
};

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'anthropic',
};

// ─── Unit ──────────────────────────────────────────────────────────

describe('AnthropicProvider — unit', () => {
  it('returns provider with name "anthropic"', () => {
    const p = anthropic({ _client: makeFakeClient([baseResponse]) });
    expect(p.name).toBe('anthropic');
  });

  it('complete() returns a normalized LLMResponse', async () => {
    const p = anthropic({ _client: makeFakeClient([baseResponse]) });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('hello');
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual({ input: 10, output: 2 });
    expect(res.stopReason).toBe('stop');
    expect(res.providerRef).toBe('msg_1');
  });

  it('translates "anthropic" model shorthand to defaultModel', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      defaultModel: 'claude-haiku-4-5',
      _client: makeFakeClient([baseResponse], recorder),
    });
    await p.complete(baseRequest);
    expect((recorder.params[0] as { model: string }).model).toBe('claude-haiku-4-5');
  });

  it('passes through full model id without translation', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });
    await p.complete({ ...baseRequest, model: 'claude-opus-4-5-20251015' });
    expect((recorder.params[0] as { model: string }).model).toBe('claude-opus-4-5-20251015');
  });

  it('extracts systemPrompt as separate field, not as a message', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });
    await p.complete({
      ...baseRequest,
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const params = recorder.params[0] as { system?: string; messages: unknown[] };
    expect(params.system).toBe('You are helpful.');
    expect(params.messages).toHaveLength(1); // user only
  });

  it('class form behaves identically to factory', async () => {
    const provider = new AnthropicProvider({ _client: makeFakeClient([baseResponse]) });
    const res = await provider.complete(baseRequest);
    expect(res.content).toBe('hello');
  });
});

// ─── Scenario — multi-turn with tool round-trip ────────────────────

describe('AnthropicProvider — scenario (multi-turn tool round-trip)', () => {
  it('reconstructs tool_use block from LLMMessage.toolCalls on follow-up turn', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });

    // Simulate iteration 2: history contains assistant turn with toolCalls
    // + tool result. The provider must rebuild the tool_use block.
    const history: LLMMessage[] = [
      { role: 'user', content: 'What is the weather in SF?' },
      {
        role: 'assistant',
        content: 'Looking that up.',
        toolCalls: [{ id: 'c1', name: 'weather', args: { city: 'SF' } }],
      },
      { role: 'tool', content: '72F sunny', toolCallId: 'c1', toolName: 'weather' },
    ];
    await p.complete({ ...baseRequest, messages: history });

    const params = recorder.params[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    // Assistant turn becomes mixed text + tool_use blocks
    const asst = params.messages[1]!;
    expect(asst.role).toBe('assistant');
    expect(Array.isArray(asst.content)).toBe(true);
    const blocks = asst.content as Array<{ type: string; [k: string]: unknown }>;
    expect(blocks.find((b) => b.type === 'text')).toMatchObject({ text: 'Looking that up.' });
    expect(blocks.find((b) => b.type === 'tool_use')).toMatchObject({
      id: 'c1',
      name: 'weather',
      input: { city: 'SF' },
    });

    // Tool result becomes a user message with tool_result content
    const toolResultMsg = params.messages[2]!;
    expect(toolResultMsg.role).toBe('user');
    const trBlocks = toolResultMsg.content as Array<{ type: string; tool_use_id?: string }>;
    expect(trBlocks[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c1' });
  });

  it('coalesces consecutive tool messages into a single user turn', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });

    const history: LLMMessage[] = [
      { role: 'user', content: 'parallel tools' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'a', args: {} },
          { id: 'c2', name: 'b', args: {} },
        ],
      },
      { role: 'tool', content: 'A done', toolCallId: 'c1' },
      { role: 'tool', content: 'B done', toolCallId: 'c2' },
    ];
    await p.complete({ ...baseRequest, messages: history });

    const params = recorder.params[0] as { messages: Array<{ content: unknown[] }> };
    // Two tool results → 1 user message with 2 tool_result blocks
    const merged = params.messages[2]!.content;
    expect(Array.isArray(merged)).toBe(true);
    expect((merged as unknown[]).length).toBe(2);
  });
});

// ─── Integration — stream() yields tokens then final response ──────

describe('AnthropicProvider — integration (stream)', () => {
  it('yields per-character text-delta chunks then a terminal chunk with response', async () => {
    const p = anthropic({ _client: makeFakeClient([baseResponse]) });
    const chunks: { content: string; done: boolean }[] = [];
    for await (const c of p.stream!(baseRequest)) {
      chunks.push({ content: c.content, done: c.done });
    }
    expect(chunks.length).toBe('hello'.length + 1);
    expect(chunks[chunks.length - 1]).toEqual({ content: '', done: true });
  });

  it('terminal chunk carries the authoritative LLMResponse', async () => {
    const p = anthropic({ _client: makeFakeClient([baseResponse]) });
    let final: { done: boolean; response?: { content: string } } = { done: false };
    for await (const c of p.stream!(baseRequest)) {
      if (c.done) final = { done: true, response: c.response };
    }
    expect(final.done).toBe(true);
    expect(final.response?.content).toBe('hello');
  });
});

// ─── Property — invariants ─────────────────────────────────────────

describe('AnthropicProvider — property', () => {
  it('system messages are NEVER passed in the messages array', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });
    await p.complete({
      ...baseRequest,
      messages: [
        { role: 'system', content: 'sys1' },
        { role: 'user', content: 'u' },
        { role: 'system', content: 'sys2' },
      ],
    });
    const params = recorder.params[0] as { messages: Array<{ role: string }> };
    expect(params.messages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('toolCalls round-trip preserves arg shape exactly', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });

    const args = { nested: { deep: [1, 2, { k: 'v' }] }, str: 'x' };
    await p.complete({
      ...baseRequest,
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'fn', args }] },
        { role: 'tool', content: 'ok', toolCallId: 'c1' },
      ],
    });

    const params = recorder.params[0] as { messages: Array<{ content: unknown }> };
    const asst = params.messages[1]!.content as Array<{ type: string; input?: unknown }>;
    const toolUse = asst.find((b) => b.type === 'tool_use')!;
    expect(toolUse.input).toEqual(args);
  });
});

// ─── Security — hostile inputs handled cleanly ─────────────────────

describe('AnthropicProvider — security', () => {
  it('throws a wrapped AnthropicProviderError when SDK rejects', async () => {
    const broken = {
      messages: {
        create: async () => {
          throw Object.assign(new Error('401 unauthorized'), { status: 401 });
        },
        stream: () => {
          throw new Error('not used');
        },
      },
    };
    const p = anthropic({ _client: broken as never });
    let caught: Error | undefined;
    try {
      await p.complete(baseRequest);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe('AnthropicProviderError');
    expect(caught?.message).toContain('401 unauthorized');
    expect((caught as { status?: number }).status).toBe(401);
  });

  it('tool_result with empty toolCallId still emits a valid block', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });
    await p.complete({
      ...baseRequest,
      messages: [
        { role: 'user', content: 'q' },
        { role: 'tool', content: 'orphan' /* no toolCallId */ },
      ],
    });
    const params = recorder.params[0] as { messages: Array<{ content: unknown }> };
    const result = (params.messages[1]!.content as Array<{ tool_use_id: string }>)[0]!;
    expect(result.tool_use_id).toBe('');
  });
});

// ─── Performance — overhead bounded ────────────────────────────────

describe('AnthropicProvider — performance', () => {
  it(
    'per-call overhead stays flat as the call count grows (fake client)',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The adapter's job per call is to map a request in and a response out.
      // Nothing may accumulate between calls, so ten times the calls costs ten
      // times the work. A ratio, not a stopwatch reading: both runs happen on
      // the same machine moments apart, so load cancels.
      const p = anthropic({ _client: makeFakeClient([baseResponse]) });
      const callTimes = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++) await p.complete(baseRequest);
      };
      await expectScalesLinearly({
        small: () => callTimes(100),
        large: () => callTimes(1000),
        scale: 10,
        why: 'the Anthropic adapter must not accumulate per-call state',
      });
    },
  );
});

// ─── ROI — realistic agent shape works end-to-end ──────────────────

describe('AnthropicProvider — ROI (realistic agent flow)', () => {
  it('handles a 2-turn tool-call cycle end-to-end with the right SDK calls', async () => {
    const recorder = { params: [] as unknown[] };
    let turn = 0;
    const p = anthropic({
      _client: makeFakeClient(() => {
        turn++;
        if (turn === 1) {
          return {
            id: 'msg_1',
            model: 'claude',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Looking up weather.' },
              { type: 'tool_use', id: 'c1', name: 'weather', input: { city: 'SF' } },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        return {
          id: 'msg_2',
          model: 'claude',
          role: 'assistant',
          content: [{ type: 'text', text: 'It is 72F sunny in SF.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 8 },
        };
      }, recorder),
    });

    // Turn 1
    const r1 = await p.complete({
      ...baseRequest,
      messages: [{ role: 'user', content: 'weather in SF' }],
    });
    expect(r1.toolCalls).toEqual([{ id: 'c1', name: 'weather', args: { city: 'SF' } }]);
    expect(r1.stopReason).toBe('tool_use');

    // Turn 2 (with tool result)
    const r2 = await p.complete({
      ...baseRequest,
      messages: [
        { role: 'user', content: 'weather in SF' },
        {
          role: 'assistant',
          content: 'Looking up weather.',
          toolCalls: [{ id: 'c1', name: 'weather', args: { city: 'SF' } }],
        },
        { role: 'tool', content: '72F sunny', toolCallId: 'c1' },
      ],
    });
    expect(r2.content).toContain('72F sunny');
    expect(r2.stopReason).toBe('stop');
  });
});

// ─── parallelToolCalls — one tool per reply, enforced by the API ────

describe('AnthropicProvider — parallelToolCalls', () => {
  const toolReq: LLMRequest = {
    ...baseRequest,
    tools: [
      { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
      { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} } },
    ],
  };
  const toolChoiceOf = (recorder: { params: unknown[] }, i = 0) =>
    (recorder.params[i] as { tool_choice?: unknown }).tool_choice;

  it('omits tool_choice by default (Anthropic keeps its own default)', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({ _client: makeFakeClient([baseResponse], recorder) });
    await p.complete(toolReq);
    expect(toolChoiceOf(recorder)).toBeUndefined();
  });

  it('parallelToolCalls: true sends nothing — it IS the API default', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: true,
      _client: makeFakeClient([baseResponse], recorder),
    });
    await p.complete(toolReq);
    expect(toolChoiceOf(recorder)).toBeUndefined();
  });

  it('parallelToolCalls: false emits tool_choice auto + disable_parallel_tool_use', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    await p.complete(toolReq);
    expect(toolChoiceOf(recorder)).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  it('never emits tool_choice on a request with no tools (Anthropic rejects it)', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    await p.complete(baseRequest); // no tools — e.g. an agent's final answer call
    expect(toolChoiceOf(recorder)).toBeUndefined();
    await p.complete({ ...baseRequest, tools: [] });
    expect(toolChoiceOf(recorder, 1)).toBeUndefined();
  });

  it('applies on the streaming path too (stream/complete parity)', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    for await (const _ of p.stream!(toolReq)) void _;
    expect(toolChoiceOf(recorder)).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  it('leaves the CHOICE of tool with the model — type stays "auto", never forced', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    await p.complete(toolReq);
    // `any`/`tool` would force a call; `auto` only caps the count.
    expect((toolChoiceOf(recorder) as { type: string }).type).toBe('auto');
  });

  it('composes with thinking + temperature without disturbing them', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    // maxTokens 1000 < budget 2000, so the thinking auto-bump must still fire.
    await p.complete({
      ...toolReq,
      temperature: 0.2,
      maxTokens: 1000,
      thinking: { budget: 2000 },
    });
    const params = recorder.params[0] as {
      tool_choice?: unknown;
      thinking?: unknown;
      temperature?: number;
      max_tokens: number;
    };
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
    expect(params.temperature).toBe(0.2);
    expect(params.max_tokens).toBe(2000 + 1024); // the thinking auto-bump still applies
  });

  it('class form honors the option', async () => {
    const recorder = { params: [] as unknown[] };
    const provider = new AnthropicProvider({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    await provider.complete(toolReq);
    expect(toolChoiceOf(recorder)).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  it('is stable across many calls — the flag is per-provider, not per-call state', async () => {
    const recorder = { params: [] as unknown[] };
    const p = anthropic({
      parallelToolCalls: false,
      _client: makeFakeClient([baseResponse], recorder),
    });
    for (let i = 0; i < 25; i++) await p.complete(toolReq);
    expect(recorder.params).toHaveLength(25);
    for (const params of recorder.params) {
      expect((params as { tool_choice?: unknown }).tool_choice).toEqual({
        type: 'auto',
        disable_parallel_tool_use: true,
      });
    }
  });
});
