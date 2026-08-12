/**
 * `LLMRequest.toolChoice` — one dialect per wire (7.26).
 *
 * The port has one arm ("force this named tool"); each adapter writes it the
 * way its API spells it. These tests read the BYTES each adapter produced,
 * because the capability declaration is a promise about the wire and a
 * promise nobody checks is a comment.
 *
 * Also pinned: the capability itself. Absence means NO — an agent using
 * `strategy: 'tool-forced'` refuses on a provider that has not declared it —
 * so which providers declare, and which deliberately do not, is part of the
 * contract rather than an implementation detail.
 */

import { describe, expect, it, vi } from 'vitest';

import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';
import { ollama } from '../../../src/adapters/llm/OllamaProvider.js';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import { gemini, type GeminiGenerateParams } from '../../../src/adapters/llm/GeminiProvider.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';

const FORCED: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'x',
  tools: [{ name: 'respond_with_schema', description: 'answer', inputSchema: { type: 'object' } }],
  toolChoice: { type: 'tool', name: 'respond_with_schema' },
};

// ─── Anthropic ─────────────────────────────────────────────────────

describe('Anthropic — forced tool choice on the wire', () => {
  function fakeClient(recorder: { params: unknown[] }) {
    return {
      messages: {
        create: vi.fn(async (params: unknown) => {
          recorder.params.push(params);
          return {
            id: 'm1',
            model: 'claude',
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: '{}' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }),
      },
    };
  }

  it("sends { type: 'tool', name }", async () => {
    const recorder = { params: [] as unknown[] };
    await anthropic({ _client: fakeClient(recorder) }).complete(FORCED);
    expect((recorder.params[0] as { tool_choice: unknown }).tool_choice).toEqual({
      type: 'tool',
      name: 'respond_with_schema',
    });
  });

  it('the forced choice wins over the parallel-tool cap', async () => {
    const recorder = { params: [] as unknown[] };
    await anthropic({ parallelToolCalls: false, _client: fakeClient(recorder) }).complete(FORCED);
    expect((recorder.params[0] as { tool_choice: { type: string } }).tool_choice.type).toBe('tool');
  });

  it('sends nothing when the request carries no tools (the API rejects it)', async () => {
    const recorder = { params: [] as unknown[] };
    const { tools: _drop, ...noTools } = FORCED;
    void _drop;
    await anthropic({ _client: fakeClient(recorder) }).complete(noTools);
    expect((recorder.params[0] as { tool_choice?: unknown }).tool_choice).toBeUndefined();
  });

  it('declares the capability', () => {
    expect(anthropic({ _client: fakeClient({ params: [] }) }).carriesForcedToolChoice).toBe(true);
  });
});

// ─── OpenAI family ─────────────────────────────────────────────────

describe('OpenAI — forced tool choice on the wire', () => {
  function fakeClient(recorder: { params: unknown[] }) {
    return {
      chat: {
        completions: {
          create: vi.fn(async (params: unknown) => {
            recorder.params.push(params);
            return {
              id: 'c1',
              model: 'gpt-4o',
              choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
          }),
        },
      },
    };
  }

  it("sends { type: 'function', function: { name } }", async () => {
    const recorder = { params: [] as unknown[] };
    await openai({ _client: fakeClient(recorder) as never }).complete(FORCED);
    expect((recorder.params[0] as { tool_choice: unknown }).tool_choice).toEqual({
      type: 'function',
      function: { name: 'respond_with_schema' },
    });
  });

  it('declares the capability for real OpenAI and NOT behind a custom baseURL', () => {
    expect(openai({ _client: fakeClient({ params: [] }) as never }).carriesForcedToolChoice).toBe(
      true,
    );
    // An OpenAI-COMPATIBLE server is somebody else's promise to make.
    expect(
      openai({ baseURL: 'http://localhost:1234/v1', _client: fakeClient({ params: [] }) as never })
        .carriesForcedToolChoice,
    ).toBe(false);
    // Ollama supports no forced tool choice on EITHER of its wires, so the
    // native adapter says so outright rather than inheriting the answer.
    expect(ollama('llama3.2').carriesForcedToolChoice).toBe(false);
  });
});

// ─── Bedrock (Converse) ────────────────────────────────────────────

describe('Bedrock — forced tool choice on the wire', () => {
  function fakeBedrock(recorder: { input: unknown[] }) {
    class Converse {
      readonly input: unknown;
      constructor(input: unknown) {
        this.input = input;
        recorder.input.push(input);
      }
    }
    return {
      client: {
        send: vi.fn(async () => ({
          output: { message: { role: 'assistant', content: [{ text: '{}' }] } },
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1 },
        })),
      },
      Commands: { Converse, ConverseStream: Converse },
    };
  }

  it('sends toolConfig.toolChoice = { tool: { name } }', async () => {
    const recorder = { input: [] as unknown[] };
    const fake = fakeBedrock(recorder);
    await bedrock({ _client: fake.client as never, _commands: fake.Commands as never }).complete(
      FORCED,
    );
    expect((recorder.input[0] as { toolConfig: unknown }).toolConfig).toMatchObject({
      toolChoice: { tool: { name: 'respond_with_schema' } },
    });
  });

  it('declares the capability', () => {
    const fake = fakeBedrock({ input: [] });
    expect(
      bedrock({ _client: fake.client as never, _commands: fake.Commands as never })
        .carriesForcedToolChoice,
    ).toBe(true);
  });
});

// ─── Gemini ────────────────────────────────────────────────────────

describe('Gemini — forced tool choice on the wire', () => {
  function fakeGemini(recorder: { params: GeminiGenerateParams[] }) {
    return {
      models: {
        async generateContent(params: GeminiGenerateParams) {
          recorder.params.push(params);
          return { candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] };
        },
        async generateContentStream() {
          throw new Error('not used here');
        },
      },
    };
  }

  it("sends functionCallingConfig = { mode: 'ANY', allowedFunctionNames: [name] }", async () => {
    const recorder = { params: [] as GeminiGenerateParams[] };
    await gemini({ _client: fakeGemini(recorder) as never }).complete(FORCED);
    expect(recorder.params[0]?.config?.toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['respond_with_schema'] },
    });
  });

  it('declares the capability on BOTH doors — the same field serves each', () => {
    const recorder = { params: [] as GeminiGenerateParams[] };
    expect(gemini({ _client: fakeGemini(recorder) as never }).carriesForcedToolChoice).toBe(true);
  });
});

// ─── Mock ──────────────────────────────────────────────────────────

describe('Mock — declares the capability so the strategy is rehearsable', () => {
  it('carriesForcedToolChoice is true', () => {
    expect(mock().carriesForcedToolChoice).toBe(true);
  });
});

// ─── Wrappers ──────────────────────────────────────────────────────

describe('resilience wrappers carry the capability across', () => {
  const declaring: LLMProvider = {
    name: 'declares',
    carriesForcedToolChoice: true,
    complete: async () => ({
      content: '{}',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    }),
  };
  const silent: LLMProvider = {
    name: 'silent',
    complete: async () => ({
      content: '{}',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'stop',
    }),
  };

  it('withRetry forwards it — a dropped capability would become a refusal', () => {
    expect(withRetry(declaring).carriesForcedToolChoice).toBe(true);
  });

  it('withFallback publishes the AND of the pair', () => {
    expect(withFallback(declaring, declaring).carriesForcedToolChoice).toBe(true);
    // Either side may serve the call, so a pair is only constrained if both are.
    expect(withFallback(declaring, silent).carriesForcedToolChoice).toBe(false);
    expect(withFallback(silent, declaring).carriesForcedToolChoice).toBe(false);
  });
});
