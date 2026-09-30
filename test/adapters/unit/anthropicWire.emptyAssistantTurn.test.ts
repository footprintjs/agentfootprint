/**
 * An assistant turn with no text, no tool calls and no thinking is DROPPED from
 * the Anthropic Messages body — on every wire that speaks it.
 *
 * The bug: `toAnthropicMessages` sent such a turn as `content: ''`. The API
 * accepts empty content only on a FINAL assistant message (a prefill), so a
 * history carrying one mid-conversation failed the whole request with a 400 —
 * and a 400 is not retried, so the run ended there. A field app kept a
 * hand-written adapter that dropped the turn, with a comment saying why; the
 * library's own `anthropic()` had a private copy of the mapping with the same
 * bug. Now all three adapters build messages through ONE owner
 * (anthropicMessagesWire · toAnthropicMessages).
 *
 * Test types (Convention 3): unit (the mapping, its index map) · scenario (the
 * body each of the three adapters sends) · boundary (a final empty turn, a
 * thinking-only turn, a tool-only turn).
 */
import { describe, it, expect } from 'vitest';
import { toAnthropicMessages } from '../../../src/adapters/llm/anthropicMessagesWire.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { invokeModelGateway } from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import type { LLMMessage, LLMRequest } from '../../../src/adapters/types.js';

const HISTORY: LLMMessage[] = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: '' },
  { role: 'user', content: 'still there?' },
  { role: 'assistant', content: 'yes' },
];

const EXPECTED = [
  { role: 'user', content: 'hi' },
  { role: 'user', content: 'still there?' },
  { role: 'assistant', content: [{ type: 'text', text: 'yes' }] },
];

const REPLY = {
  id: 'm',
  model: 'x',
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

const REQ: LLMRequest = { model: 'anthropic', messages: HISTORY };

describe('toAnthropicMessages — an empty assistant turn', () => {
  it('is dropped, and the index map says it did not survive (-1)', () => {
    const indexMap: number[] = [];
    expect(toAnthropicMessages(HISTORY, indexMap)).toStrictEqual(EXPECTED);
    expect(indexMap).toStrictEqual([0, -1, 1, 2]);
  });

  it('is dropped at the END of the history too — the library sends no prefill', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
    ]);
    expect(out).toStrictEqual([{ role: 'user', content: 'hi' }]);
  });

  it('a turn with only tool calls, or only thinking blocks, is kept', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', args: {} }] },
      { role: 'tool', content: 'r', toolCallId: 'c1' },
      {
        role: 'assistant',
        content: '',
        thinkingBlocks: [{ type: 'thinking', content: 'hm', signature: 's' }],
      } as never,
    ]);
    expect(out.map((m) => m.role)).toStrictEqual(['user', 'assistant', 'user', 'assistant']);
    expect(out[1]!.content).toStrictEqual([{ type: 'tool_use', id: 'c1', name: 't', input: {} }]);
    expect(out[3]!.content).toStrictEqual([{ type: 'thinking', thinking: 'hm', signature: 's' }]);
  });

  it('no message in any body is ever empty content', () => {
    const out = toAnthropicMessages([
      { role: 'assistant', content: '' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'b' },
    ]);
    for (const m of out) {
      expect(m.content === '' || (Array.isArray(m.content) && m.content.length === 0)).toBe(false);
    }
  });
});

describe('every adapter on the wire sends the dropped body', () => {
  it('anthropic()', async () => {
    const seen: unknown[] = [];
    const client = {
      messages: {
        create: async (params: { messages: unknown }) => {
          seen.push(params.messages);
          return REPLY;
        },
        stream: () => {
          throw new Error('not used');
        },
      },
    };
    await anthropic({ _client: client as never }).complete(REQ);
    expect(seen).toStrictEqual([EXPECTED]);
  });

  it('browserAnthropic()', async () => {
    const seen: unknown[] = [];
    const provider = browserAnthropic({
      apiKey: 'k',
      _fetch: (async (_url: string, init: RequestInit) => {
        seen.push((JSON.parse(String(init.body)) as { messages: unknown }).messages);
        return new Response(JSON.stringify(REPLY), { status: 200 });
      }) as never,
    });
    await provider.complete(REQ);
    expect(seen).toStrictEqual([EXPECTED]);
  });

  it('invokeModelGateway()', async () => {
    const seen: unknown[] = [];
    const provider = invokeModelGateway({
      baseUrl: 'https://gw.example.com',
      apiKeyHeader: 'api-key',
      apiKey: 'k',
      model: 'm1',
      fetch: async (_url, init) => {
        seen.push((JSON.parse(String(init?.body)) as { messages: unknown }).messages);
        return new Response(JSON.stringify(REPLY), { status: 200 });
      },
    });
    await provider.complete({ ...REQ, model: 'invoke-model-gateway' });
    expect(seen).toStrictEqual([EXPECTED]);
  });
});
