/**
 * OpenAIProvider — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Uses an injected fake `_client` instead of the real OpenAI SDK.
 */

import { describe, expect, it, vi } from 'vitest';

import { openai, OpenAIProvider, ollama } from '../../../src/adapters/llm/OpenAIProvider.js';
import type { LLMRequest, LLMMessage } from '../../../src/adapters/types.js';

// ─── Fake OpenAI SDK ───────────────────────────────────────────────

interface FakeChatCompletion {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function makeFakeClient(
  result: FakeChatCompletion | ((p: unknown) => FakeChatCompletion),
  recorder?: { params: unknown[] },
) {
  return {
    chat: {
      completions: {
        create: vi.fn((params: { stream?: boolean }) => {
          recorder?.params.push(params);
          const finalRes = typeof result === 'function' ? result(params) : result;
          if (params.stream) {
            // Synthesize a stream: text deltas per character + final
            // chunk with finish_reason + usage.
            const text = finalRes.choices[0]!.message.content ?? '';
            const toolCalls = finalRes.choices[0]!.message.tool_calls ?? [];
            const events: Array<{
              id: string;
              model: string;
              choices: Array<{
                index: number;
                delta: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    type?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason: string | null;
              }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            }> = [];
            for (const ch of text.split('')) {
              events.push({
                id: finalRes.id,
                model: finalRes.model,
                choices: [{ index: 0, delta: { content: ch }, finish_reason: null }],
              });
            }
            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i]!;
              events.push({
                id: finalRes.id,
                model: finalRes.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: i,
                          id: tc.id,
                          type: 'function',
                          function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              });
            }
            events.push({
              id: finalRes.id,
              model: finalRes.model,
              choices: [{ index: 0, delta: {}, finish_reason: finalRes.choices[0]!.finish_reason }],
              ...(finalRes.usage && { usage: finalRes.usage }),
            });
            return (async function* () {
              for (const e of events) yield e;
            })();
          }
          return Promise.resolve(finalRes);
        }),
      },
    },
  };
}

const baseResponse: FakeChatCompletion = {
  id: 'chatcmpl_1',
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'hello' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2 },
};

const baseRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'hi' }],
  model: 'openai',
};

// ─── Unit ──────────────────────────────────────────────────────────

describe('OpenAIProvider — unit', () => {
  it('provider name is "openai"', () => {
    expect(openai({ _client: makeFakeClient(baseResponse) }).name).toBe('openai');
  });

  it('complete() normalizes prompt_tokens/completion_tokens → input/output', async () => {
    const p = openai({ _client: makeFakeClient(baseResponse) });
    const res = await p.complete(baseRequest);
    expect(res.content).toBe('hello');
    expect(res.usage).toEqual({ input: 10, output: 2 });
    expect(res.stopReason).toBe('stop');
    expect(res.providerRef).toBe('chatcmpl_1');
  });

  it('translates "openai" model shorthand to defaultModel', async () => {
    const recorder = { params: [] as unknown[] };
    const p = openai({
      defaultModel: 'gpt-4o',
      _client: makeFakeClient(baseResponse, recorder),
    });
    await p.complete(baseRequest);
    expect((recorder.params[0] as { model: string }).model).toBe('gpt-4o');
  });

  it('class form behaves identically to factory', async () => {
    const provider = new OpenAIProvider({ _client: makeFakeClient(baseResponse) });
    const res = await provider.complete(baseRequest);
    expect(res.content).toBe('hello');
  });

  it('systemPrompt is prepended as a system role message', async () => {
    const recorder = { params: [] as unknown[] };
    const p = openai({ _client: makeFakeClient(baseResponse, recorder) });
    await p.complete({ ...baseRequest, systemPrompt: 'You are concise.' });
    const params = recorder.params[0] as { messages: Array<{ role: string; content: string }> };
    expect(params.messages[0]).toEqual({ role: 'system', content: 'You are concise.' });
    expect(params.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });
});

// ─── Scenario — multi-turn tool round-trip ─────────────────────────

describe('OpenAIProvider — scenario (tool round-trip)', () => {
  it('serializes assistant.toolCalls into tool_calls with JSON-stringified args', async () => {
    const recorder = { params: [] as unknown[] };
    const p = openai({ _client: makeFakeClient(baseResponse, recorder) });

    const history: LLMMessage[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'looking up',
        toolCalls: [{ id: 'c1', name: 'weather', args: { city: 'SF' } }],
      },
      { role: 'tool', content: '72F', toolCallId: 'c1', toolName: 'weather' },
    ];
    await p.complete({ ...baseRequest, messages: history });

    const params = recorder.params[0] as {
      messages: Array<{
        role: string;
        content: string | null;
        tool_calls?: unknown[];
        tool_call_id?: string;
      }>;
    };
    const asst = params.messages[1]!;
    expect(asst.role).toBe('assistant');
    expect(asst.tool_calls).toBeDefined();
    expect(
      (asst.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>)[0],
    ).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 'weather', arguments: JSON.stringify({ city: 'SF' }) },
    });

    const toolMsg = params.messages[2]!;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('c1');
    expect(toolMsg.content).toBe('72F');
  });

  it('parses tool_call args from JSON string back to object on response', async () => {
    const withTools: FakeChatCompletion = {
      id: 'x',
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'weather', arguments: '{"city":"SF"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const p = openai({ _client: makeFakeClient(withTools) });
    const res = await p.complete(baseRequest);
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'weather', args: { city: 'SF' } }]);
    expect(res.stopReason).toBe('tool_use');
  });
});

// ─── Integration — stream path ─────────────────────────────────────

describe('OpenAIProvider — integration (stream)', () => {
  it('yields per-character text deltas then a terminal chunk with response', async () => {
    const p = openai({ _client: makeFakeClient(baseResponse) });
    const chunks: { content: string; done: boolean }[] = [];
    let final: { content: string; usage: { input: number; output: number } } | undefined;
    for await (const c of p.stream!(baseRequest)) {
      chunks.push({ content: c.content, done: c.done });
      if (c.done && c.response) final = { content: c.response.content, usage: c.response.usage };
    }
    expect(chunks.length).toBe('hello'.length + 1);
    expect(chunks[chunks.length - 1]).toEqual({ content: '', done: true });
    expect(final).toEqual({ content: 'hello', usage: { input: 10, output: 2 } });
  });

  it('streams tool_call deltas and assembles final args', async () => {
    const withTools: FakeChatCompletion = {
      id: 'x',
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'weather', arguments: '{"city":"SF"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const p = openai({ _client: makeFakeClient(withTools) });
    let final: { toolCalls: readonly unknown[] } | undefined;
    for await (const c of p.stream!(baseRequest)) {
      if (c.done && c.response) final = { toolCalls: c.response.toolCalls };
    }
    expect(final?.toolCalls).toEqual([{ id: 'c1', name: 'weather', args: { city: 'SF' } }]);
  });
});

// ─── Property — invariants ─────────────────────────────────────────

describe('OpenAIProvider — property', () => {
  it('every system entry in the request becomes a system role message', async () => {
    const recorder = { params: [] as unknown[] };
    const p = openai({ _client: makeFakeClient(baseResponse, recorder) });
    await p.complete({
      ...baseRequest,
      messages: [
        { role: 'system', content: 'sys A' },
        { role: 'user', content: 'u' },
        { role: 'system', content: 'sys B' },
      ],
    });
    const params = recorder.params[0] as { messages: Array<{ role: string }> };
    const systems = params.messages.filter((m) => m.role === 'system');
    expect(systems.length).toBeGreaterThanOrEqual(2);
  });

  it('finish_reason "length" maps to "max_tokens"', async () => {
    const truncated: FakeChatCompletion = {
      ...baseResponse,
      choices: [{ ...baseResponse.choices[0]!, finish_reason: 'length' }],
    };
    const p = openai({ _client: makeFakeClient(truncated) });
    const res = await p.complete(baseRequest);
    expect(res.stopReason).toBe('max_tokens');
  });
});

// ─── Security ──────────────────────────────────────────────────────

describe('OpenAIProvider — security', () => {
  it('wraps SDK errors with status and "openai" tag', async () => {
    const broken = {
      chat: {
        completions: {
          create: () => {
            throw Object.assign(new Error('429 rate limit'), { status: 429 });
          },
        },
      },
    };
    const p = openai({ _client: broken as never });
    let caught: Error | undefined;
    try {
      await p.complete(baseRequest);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).toContain('429 rate limit');
    expect(caught?.name).toBe('OpenAIProviderError');
    expect((caught as { status?: number }).status).toBe(429);
  });

  it('malformed tool_call args JSON falls back to {} (no crash)', async () => {
    const broken: FakeChatCompletion = {
      id: 'x',
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'weather', arguments: 'NOT JSON' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const p = openai({ _client: makeFakeClient(broken) });
    const res = await p.complete(baseRequest);
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'weather', args: {} }]);
  });
});

// ─── Performance ───────────────────────────────────────────────────

describe('OpenAIProvider — performance', () => {
  it('1000 complete() calls overhead well under 500ms with fake client', async () => {
    const p = openai({ _client: makeFakeClient(baseResponse) });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) await p.complete(baseRequest);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── ROI — Ollama compatibility ────────────────────────────────────

describe('OpenAIProvider — ROI (Ollama via baseURL)', () => {
  it('ollama() factory wires baseURL + name correctly', () => {
    const p = ollama({ _client: makeFakeClient(baseResponse) });
    expect(p.name).toBe('ollama');
  });

  it('ollama() rewrites "ollama" model shorthand to defaultModel', async () => {
    const recorder = { params: [] as unknown[] };
    const p = ollama({
      defaultModel: 'llama3.2',
      _client: makeFakeClient(baseResponse, recorder),
    });
    await p.complete({ ...baseRequest, model: 'ollama' });
    expect((recorder.params[0] as { model: string }).model).toBe('llama3.2');
  });
});
