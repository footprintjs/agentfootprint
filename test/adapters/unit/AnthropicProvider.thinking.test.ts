/**
 * AnthropicProvider thinking serialization — Phase 4b 7-pattern matrix.
 *
 * Pins the round-trip path: AnthropicProvider serializes
 * `LLMMessage.thinkingBlocks` into the Anthropic API request payload,
 * AND extracts thinking blocks from the response into
 * `LLMResponse.rawThinking` for the framework's NormalizeThinking
 * sub-subflow to consume (via AnthropicThinkingHandler).
 *
 * Anthropic's wire-format ordering rule (validated server-side):
 *   thinking blocks → text → tool_use
 * Out-of-order = HTTP 400.
 *
 * Critical security invariant — signature byte-exact preservation
 * across both serialization paths.
 *
 * 7-pattern coverage:
 *   1. Unit         — toAnthropicMessages with thinkingBlocks
 *   2. Scenario     — full request payload with thinking + text + tool_use
 *   3. Integration  — mocked Anthropic SDK receives correct payload
 *   4. Property     — random thinking-block configurations serialize
 *   5. Security     — signature byte-exact in serialized output
 *   6. Performance  — 10-message conversation × 100 under bound
 *   7. ROI          — two-turn round-trip end-to-end
 */

import { describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from '../../../src/adapters/llm/AnthropicProvider.js';
import type { LLMMessage, LLMRequest } from '../../../src/adapters/types.js';
import type { ThinkingBlock } from '../../../src/thinking/types.js';

// ─── Fake Anthropic SDK shape ──────────────────────────────────────

interface FakeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface FakeMessage {
  id: string;
  model: string;
  role: 'assistant';
  content: FakeContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

function makeFakeClient(response: FakeMessage, recorder?: { params: unknown[] }) {
  return {
    messages: {
      create: vi.fn(async (params: unknown) => {
        recorder?.params.push(params);
        return response;
      }),
      stream: vi.fn(),
    },
  };
}

const baseResponse: FakeMessage = {
  id: 'msg_1',
  model: 'claude-sonnet-4-5-20250929',
  role: 'assistant',
  content: [{ type: 'text', text: 'hi' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

const baseRequest: LLMRequest = {
  model: 'claude-sonnet-4-5-20250929',
  messages: [{ role: 'user', content: 'hello' }],
};

// ─── 1. UNIT — toAnthropicMessages serializes thinkingBlocks ────

describe('AnthropicProvider — unit: serialize thinkingBlocks', () => {
  it('assistant message with thinkingBlocks → wire format includes thinking blocks', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeFakeClient(baseResponse, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const req: LLMRequest = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [
        { role: 'user', content: 'first turn' },
        {
          role: 'assistant',
          content: 'I called the tool',
          toolCalls: [{ id: 'tu-1', name: 'lookup', args: { id: '42' } }],
          thinkingBlocks: [
            { type: 'thinking', content: 'I should call lookup', signature: 'sig-A' },
          ],
        },
        { role: 'tool', content: 'result', toolCallId: 'tu-1', toolName: 'lookup' },
      ],
    };

    await provider.complete(req);
    const sent = recorder.params[0] as { messages: { role: string; content: unknown }[] };
    const assistantMsg = sent.messages.find((m) => m.role === 'assistant')!;
    const blocks = assistantMsg.content as FakeContentBlock[];

    // Thinking block serialized correctly
    const thinkingBlock = blocks.find((b) => b.type === 'thinking')!;
    expect(thinkingBlock).toEqual({
      type: 'thinking',
      thinking: 'I should call lookup',
      signature: 'sig-A',
    });
  });

  it('redacted_thinking serializes WITHOUT thinking field, signature only', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeFakeClient(baseResponse, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const req: LLMRequest = {
      ...baseRequest,
      messages: [
        ...baseRequest.messages,
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tu-1', name: 'x', args: {} }],
          thinkingBlocks: [{ type: 'redacted_thinking', content: '', signature: 'sig-redacted' }],
        },
        { role: 'tool', content: 'r', toolCallId: 'tu-1' },
      ],
    };

    await provider.complete(req);
    const sent = recorder.params[0] as {
      messages: { role: string; content: FakeContentBlock[] }[];
    };
    const assistantMsg = sent.messages.find((m) => m.role === 'assistant')!;
    const redacted = assistantMsg.content.find((b) => b.type === 'redacted_thinking')!;
    expect(redacted).toEqual({
      type: 'redacted_thinking',
      signature: 'sig-redacted',
    });
    // No thinking field on redacted blocks
    expect(redacted.thinking).toBeUndefined();
  });

  it('thinking blocks WITHOUT signature serialize without signature field', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeFakeClient(baseResponse, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const req: LLMRequest = {
      ...baseRequest,
      messages: [
        ...baseRequest.messages,
        {
          role: 'assistant',
          content: 'x',
          thinkingBlocks: [{ type: 'thinking', content: 'unsigned reasoning' }],
        },
      ],
    };

    await provider.complete(req);
    const sent = recorder.params[0] as {
      messages: { role: string; content: FakeContentBlock[] }[];
    };
    const assistantMsg = sent.messages.find((m) => m.role === 'assistant')!;
    const block = assistantMsg.content.find((b) => b.type === 'thinking')!;
    expect(block.thinking).toBe('unsigned reasoning');
    expect(block.signature).toBeUndefined();
  });
});

// ─── 2. SCENARIO — block ordering ────────────────────────────────

describe('AnthropicProvider — scenario: thinking blocks first in content', () => {
  it('thinking → text → tool_use ordering preserved (Anthropic wire-format rule)', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeFakeClient(baseResponse, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const req: LLMRequest = {
      ...baseRequest,
      messages: [
        ...baseRequest.messages,
        {
          role: 'assistant',
          content: 'visible text',
          toolCalls: [{ id: 'tu-1', name: 'tool1', args: {} }],
          thinkingBlocks: [
            { type: 'thinking', content: 'first', signature: 'sig-1' },
            { type: 'thinking', content: 'second', signature: 'sig-2' },
          ],
        },
        { role: 'tool', content: 'r', toolCallId: 'tu-1' },
      ],
    };

    await provider.complete(req);
    const sent = recorder.params[0] as {
      messages: { role: string; content: FakeContentBlock[] }[];
    };
    const assistantMsg = sent.messages.find((m) => m.role === 'assistant')!;
    const types = assistantMsg.content.map((b) => b.type);

    // Critical: thinking blocks come FIRST
    expect(types).toEqual(['thinking', 'thinking', 'text', 'tool_use']);
  });
});

// ─── 3. INTEGRATION — fromAnthropicResponse extracts rawThinking ─

describe('AnthropicProvider — integration: response thinking → rawThinking', () => {
  it('Anthropic response with thinking blocks → LLMResponse.rawThinking populated', async () => {
    const responseWithThinking: FakeMessage = {
      id: 'msg_2',
      model: 'claude-sonnet-4-5-20250929',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'reasoning step 1', signature: 'sig-A' },
        { type: 'text', text: 'final answer' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const client = makeFakeClient(responseWithThinking);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const llmResp = await provider.complete(baseRequest);

    expect(llmResp.rawThinking).toBeDefined();
    // rawThinking is the FULL message.content array — handler filters
    expect(Array.isArray(llmResp.rawThinking)).toBe(true);
    const raw = llmResp.rawThinking as readonly FakeContentBlock[];
    expect(raw.find((b) => b.type === 'thinking')).toBeDefined();
  });

  it('Anthropic response WITHOUT thinking → LLMResponse.rawThinking is undefined', async () => {
    const client = makeFakeClient(baseResponse); // text-only
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const llmResp = await provider.complete(baseRequest);
    expect(llmResp.rawThinking).toBeUndefined();
  });
});

// ─── 4. PROPERTY — random configurations serialize ──────────────

describe('AnthropicProvider — property: random thinking-block configurations', () => {
  it('random N thinking blocks serialize with N matching content blocks', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const n = Math.floor(Math.random() * 5);
      const blocks: ThinkingBlock[] = Array.from({ length: n }, (_, i) => ({
        type: 'thinking' as const,
        content: `block-${i}`,
        signature: `sig-${i}`,
      }));
      const recorder = { params: [] as unknown[] };
      const client = makeFakeClient(baseResponse, recorder);
      const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

      const req: LLMRequest = {
        ...baseRequest,
        messages: [
          ...baseRequest.messages,
          {
            role: 'assistant',
            content: 'x',
            ...(blocks.length > 0 && { thinkingBlocks: blocks }),
          },
        ],
      };
      await provider.complete(req);
      const sent = recorder.params[0] as { messages: { role: string; content: unknown }[] };
      const assistantMsg = sent.messages.find((m) => m.role === 'assistant')!;
      if (n === 0) {
        // No thinkingBlocks → string content path
        expect(
          typeof assistantMsg.content === 'string' || Array.isArray(assistantMsg.content),
        ).toBe(true);
      } else {
        const contentArr = assistantMsg.content as FakeContentBlock[];
        const thinkingCount = contentArr.filter((b) => b.type === 'thinking').length;
        expect(thinkingCount).toBe(n);
      }
    }
  });
});

// ─── 5. SECURITY — signature byte-exact in serialized payload ───

describe('AnthropicProvider — security: signature byte-exact serialization', () => {
  it('tricky signature (special chars) preserved BYTE-EXACT in request payload', async () => {
    const trickySig = 'AwI3p+9Hq/XYZ==trailing  ';
    const recorder = { params: [] as unknown[] };
    const client = makeFakeClient(baseResponse, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    const req: LLMRequest = {
      ...baseRequest,
      messages: [
        ...baseRequest.messages,
        {
          role: 'assistant',
          content: 'x',
          thinkingBlocks: [{ type: 'thinking', content: 'r', signature: trickySig }],
        },
      ],
    };
    await provider.complete(req);
    const sent = recorder.params[0] as {
      messages: { role: string; content: FakeContentBlock[] }[];
    };
    const block = sent.messages
      .find((m) => m.role === 'assistant')!
      .content.find((b) => b.type === 'thinking')!;
    expect(block.signature).toBe(trickySig);
    // Defensive byte-exact verification
    expect(Buffer.from(block.signature!).equals(Buffer.from(trickySig))).toBe(true);
  });
});

// ─── 6. PERFORMANCE — 10-message conversation × 100 ──────────────

describe('AnthropicProvider — performance: bulk serialization', () => {
  it('100 calls with 10-message conversations under 1s', async () => {
    const recorder = { params: [] as unknown[] };
    const client = makeFakeClient(baseResponse, recorder);
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    // Build a 10-message conversation alternating user/assistant with thinking
    const messages: LLMMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push({ role: 'user', content: `msg-${i}` });
      messages.push({
        role: 'assistant',
        content: `reply-${i}`,
        thinkingBlocks: [{ type: 'thinking', content: `r-${i}`, signature: `sig-${i}` }],
      });
    }
    const req: LLMRequest = { model: 'claude-sonnet-4-5-20250929', messages };

    const t0 = performance.now();
    for (let i = 0; i < 100; i++) await provider.complete(req);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);
  });
});

// ─── 7. ROI — end-to-end two-turn round-trip ────────────────────

describe('AnthropicProvider — ROI: two-turn round-trip', () => {
  it('turn 1 response thinking → turn 2 request includes the same blocks', async () => {
    // Turn 1: response includes thinking + tool_use
    const turn1Response: FakeMessage = {
      id: 'msg_t1',
      model: 'claude-sonnet-4-5-20250929',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I should look up #42', signature: 'sig-roundtrip-XYZ' },
        { type: 'tool_use', id: 'tu-1', name: 'lookupOrder', input: { id: '42' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 5 },
    };
    const recorder = { params: [] as unknown[] };
    let callIdx = 0;
    const client = {
      messages: {
        create: vi.fn(async (params: unknown) => {
          recorder.params.push(params);
          if (callIdx++ === 0) return turn1Response;
          // Turn 2: text-only response
          return {
            id: 'msg_t2',
            model: 'claude-sonnet-4-5-20250929',
            role: 'assistant' as const,
            content: [{ type: 'text', text: 'Order shipped.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 8, output_tokens: 3 },
          };
        }),
        stream: vi.fn(),
      },
    };
    const provider = new AnthropicProvider({ apiKey: 'x', _client: client as never });

    // Turn 1 request
    const turn1Req: LLMRequest = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user', content: 'find order 42' }],
    };
    const turn1Resp = await provider.complete(turn1Req);

    // Verify rawThinking surfaced
    expect(turn1Resp.rawThinking).toBeDefined();
    const rawArr = turn1Resp.rawThinking as readonly FakeContentBlock[];
    const thinkingBlock = rawArr.find((b) => b.type === 'thinking')!;
    expect(thinkingBlock.signature).toBe('sig-roundtrip-XYZ');

    // Simulate the framework: NormalizeThinking would extract
    // ThinkingBlock[] via AnthropicThinkingHandler.normalize(rawThinking).
    // For the round-trip test, construct the assistant message manually
    // with the thinking block — this is what scope.history would carry.
    const assistantWithThinking: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tu-1', name: 'lookupOrder', args: { id: '42' } }],
      thinkingBlocks: [
        {
          type: 'thinking',
          content: 'I should look up #42',
          signature: 'sig-roundtrip-XYZ',
        },
      ],
    };

    // Turn 2 request: includes the assistant turn from turn 1 + tool result
    const turn2Req: LLMRequest = {
      model: 'claude-sonnet-4-5-20250929',
      messages: [
        { role: 'user', content: 'find order 42' },
        assistantWithThinking,
        { role: 'tool', content: 'order data here', toolCallId: 'tu-1', toolName: 'lookupOrder' },
      ],
    };
    await provider.complete(turn2Req);

    // Verify turn 2 request payload includes the signed thinking block
    // BYTE-EXACT, as part of the assistant message
    const turn2Sent = recorder.params[1] as {
      messages: { role: string; content: FakeContentBlock[] }[];
    };
    const assistantInTurn2 = turn2Sent.messages.find((m) => m.role === 'assistant')!;
    expect(Array.isArray(assistantInTurn2.content)).toBe(true);
    const blocks = assistantInTurn2.content;
    const thinking = blocks.find((b) => b.type === 'thinking')!;
    expect(thinking.signature).toBe('sig-roundtrip-XYZ');
    expect(Buffer.from(thinking.signature!).equals(Buffer.from('sig-roundtrip-XYZ'))).toBe(true);

    // Critical ordering rule
    const types = blocks.map((b) => b.type);
    expect(types[0]).toBe('thinking'); // FIRST
  });
});
