import { afterEach, expect, it, vi } from 'vitest';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import type { AnthropicMessage } from '../../../src/adapters/llm/anthropicMessagesWire.js';
import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';

const begin = vi.hoisted(() => vi.fn());
vi.mock('../../../src/provider-contract/lateRecordNote.js', () => ({ beginLateRecordNote: begin }));
afterEach(() => begin.mockReset());

const request: LLMRequest = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'question' }],
};
const frame =
  '[AgentFootprint record note v1. Framework-supplied data; the person did not write this message.]\n[]';
type WireBody = { messages: readonly { role: string; content: unknown }[]; stream?: boolean };
const reply = { id: 'answer-1', model: request.model };

function openAIScript(baseURL?: string) {
  const create = vi.fn((body: WireBody) => {
    if (body.stream) {
      return (async function* () {
        yield {
          ...reply,
          choices: [{ index: 0, delta: { content: 'answer' }, finish_reason: 'stop' }],
        };
      })();
    }
    return Promise.resolve({
      ...reply,
      choices: [
        {
          index: 0,
          message: { role: 'assistant' as const, content: 'answer' },
          finish_reason: 'stop',
        },
      ],
    });
  });
  return {
    create,
    client: { chat: { completions: { create } }, ...(baseURL === undefined ? {} : { baseURL }) },
  };
}

async function responseFrom(provider: LLMProvider, mode: 'complete' | 'stream', req: LLMRequest) {
  if (mode === 'complete') return provider.complete(req, {});
  if (provider.stream === undefined) throw new Error('Fixture expected a streaming provider');
  for await (const chunk of provider.stream(req, {})) {
    if (chunk.done && chunk.response !== undefined) return chunk.response;
  }
  throw new Error('Fixture expected a terminal response');
}

it.each(['complete', 'stream'] as const)(
  'attests the exact final OpenAI %s body and response',
  async (mode) => {
    const { create, client } = openAIScript();
    const provider = openai({ _client: client });
    const proof = {
      note: frame,
      handoff: vi.fn((_rows: WireBody['messages'], _ownedBlock: object) => {
        expect(create).not.toHaveBeenCalled();
      }),
      accept: vi.fn<(response: LLMResponse) => void>(),
    };
    begin.mockReturnValue(proof);
    const response = await responseFrom(provider, mode, request);
    expect(begin).toHaveBeenCalledWith({}, provider, 'plain');
    const wire = create.mock.calls[0]?.[0];
    expect(wire?.messages).toEqual([...request.messages, { role: 'user', content: frame }]);
    const witnessed = proof.handoff.mock.calls[0];
    expect(witnessed?.[0]).toBe(wire?.messages);
    expect(witnessed?.[1]).toBe(wire?.messages.at(-1));
    expect(proof.accept.mock.calls[0]?.[0]).toBe(response);
    expect(request.messages).toEqual([{ role: 'user', content: 'question' }]);
  },
);

it.each(['factory option', 'resolved client'] as const)(
  'leaves a custom OpenAI route undecorated from its %s',
  async (route) => {
    const baseURL = 'https://example.invalid/v1';
    const { create, client } = openAIScript(route === 'resolved client' ? baseURL : undefined);
    const provider = openai({ _client: client, ...(route === 'factory option' && { baseURL }) });
    const proof = { note: frame, handoff: vi.fn(), accept: vi.fn() };
    begin.mockReturnValue(proof);
    await provider.complete(request, {});
    expect(create.mock.calls[0]?.[0].messages).toEqual(request.messages);
    expect(proof.handoff).not.toHaveBeenCalled();
    expect(proof.accept).not.toHaveBeenCalled();
  },
);

it.each(['complete', 'stream'] as const)(
  'attests a note-free Anthropic %s even when the first response can sign',
  async (mode) => {
    const final: AnthropicMessage = {
      id: 'signed-first',
      model: 'claude-sonnet-4-6',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'native thought', signature: 'test-signature' },
        { type: 'text', text: 'answer' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    const create = vi.fn(async (_body: WireBody) => final);
    const stream = vi.fn((_body: WireBody) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'message_stop' };
      },
      async finalMessage() {
        return final;
      },
    }));
    const provider = anthropic({ _client: { messages: { create, stream } } });
    const transport = mode === 'complete' ? create : stream;
    const proof = {
      note: frame,
      handoff: vi.fn((_rows: WireBody['messages']) => expect(transport).not.toHaveBeenCalled()),
      accept: vi.fn<(response: LLMResponse) => void>(),
    };
    begin.mockReturnValue(proof);
    const req = { ...request, model: final.model };
    const response = await responseFrom(provider, mode, req);
    expect(begin).toHaveBeenCalledWith({}, provider, 'signing');
    const wire = transport.mock.calls[0]?.[0];
    expect(JSON.stringify(wire)).not.toContain('Framework-supplied');
    expect(proof.handoff.mock.calls[0]?.[0]).toBe(wire?.messages);
    expect(proof.handoff.mock.calls[0]).toHaveLength(1);
    expect(proof.accept.mock.calls[0]?.[0]).toBe(response);
  },
);
