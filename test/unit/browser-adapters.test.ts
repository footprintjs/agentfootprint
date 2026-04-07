import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserAnthropicAdapter } from '../../src/adapters/browser/BrowserAnthropicAdapter';
import { BrowserOpenAIAdapter } from '../../src/adapters/browser/BrowserOpenAIAdapter';
import type { Message } from '../../src/types';
import { LLMError } from '../../src/types/errors';

// ── Helpers ──────────────────────────────────────────────────

const messages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello' },
];

function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    body: null,
  });
}

function mockSSEFetch(events: string[]): ReturnType<typeof vi.fn> {
  const encoded = new TextEncoder().encode(events.join('\n') + '\n');
  let read = false;
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => {
          if (read) return Promise.resolve({ done: true, value: undefined });
          read = true;
          return Promise.resolve({ done: false, value: encoded });
        },
        releaseLock: () => {},
      }),
    },
  });
}

// ── BrowserAnthropicAdapter ─────────────────────────────────

describe('BrowserAnthropicAdapter', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct headers including CORS header', async () => {
    const fetchMock = mockFetch({
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-20250514',
    });

    await adapter.chat(messages);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-ant-test');
    expect(opts.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('chat() returns LLMResponse with content and usage', async () => {
    globalThis.fetch = mockFetch({
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello there!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 15, output_tokens: 8 },
    });

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const result = await adapter.chat(messages);

    expect(result.content).toBe('Hello there!');
    expect(result.usage).toEqual({
      inputTokens: 15,
      outputTokens: 8,
      totalTokens: 23,
    });
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  it('chat() returns tool_calls when stop_reason is tool_use', async () => {
    globalThis.fetch = mockFetch({
      id: 'msg_2',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me search.' },
        { type: 'tool_use', id: 'tc_1', name: 'search', input: { query: 'weather' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 15 },
    });

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const result = await adapter.chat(messages);

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'tc_1',
      name: 'search',
      arguments: { query: 'weather' },
    });
  });

  it('extracts system prompt from messages', async () => {
    const fetchMock = mockFetch({
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    await adapter.chat(messages);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toBe('You are a helpful assistant.');
    // System message should not appear in messages array
    expect(body.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
  });

  it('throws LLMError on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    });

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'bad-key',
      model: 'claude-sonnet-4-20250514',
    });

    await expect(adapter.chat(messages)).rejects.toThrow(LLMError);
    try {
      await adapter.chat(messages);
    } catch (e) {
      expect((e as LLMError).code).toBe('auth');
      expect((e as LLMError).provider).toBe('anthropic-browser');
      expect((e as LLMError).statusCode).toBe(401);
    }
  });

  it('throws LLMError with aborted code on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    try {
      await adapter.chat(messages);
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).code).toBe('aborted');
    }
  });

  it('supports custom baseURL', async () => {
    const fetchMock = mockFetch({
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'https://proxy.example.com/v1/messages',
    });

    await adapter.chat(messages);
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.example.com/v1/messages');
  });

  it('chatStream() yields tokens and usage', async () => {
    globalThis.fetch = mockSSEFetch([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      'data: {"type":"message_stop","message":{"id":"msg_1","model":"claude-sonnet-4-20250514","role":"assistant","content":[{"type":"text","text":"Hello world"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":5}}}',
    ]);

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const chunks: import('../../src/types').LLMStreamChunk[] = [];
    for await (const chunk of adapter.chatStream(messages)) {
      chunks.push(chunk);
    }

    const tokens = chunks.filter((c) => c.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].content).toBe('Hello');
    expect(tokens[1].content).toBe(' world');

    const usageChunks = chunks.filter((c) => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0].usage!.inputTokens).toBe(10);

    expect(chunks[chunks.length - 1].type).toBe('done');
  });

  it('converts tool result messages into user message blocks', async () => {
    const fetchMock = mockFetch({
      id: 'msg_1',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'Got it.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 3 },
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserAnthropicAdapter({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const toolMessages: Message[] = [
      { role: 'user', content: 'Search for weather' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc_1', name: 'search', arguments: { q: 'weather' } }],
      },
      { role: 'tool', content: 'Sunny, 72F', toolCallId: 'tc_1' },
    ];

    await adapter.chat(toolMessages);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Tool result should be in a user message with tool_result content block
    const lastMsg = body.messages[body.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content[0].type).toBe('tool_result');
    expect(lastMsg.content[0].tool_use_id).toBe('tc_1');
  });
});

// ── BrowserOpenAIAdapter ────────────────────────────────────

describe('BrowserOpenAIAdapter', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends correct Authorization header', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hi!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'sk-test-key',
      model: 'gpt-4o',
    });

    await adapter.chat(messages);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers['Authorization']).toBe('Bearer sk-test-key');
  });

  it('chat() returns LLMResponse with content and usage', async () => {
    globalThis.fetch = mockFetch({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello there!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
    });

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const result = await adapter.chat(messages);

    expect(result.content).toBe('Hello there!');
    expect(result.usage).toEqual({
      inputTokens: 15,
      outputTokens: 8,
      totalTokens: 23,
    });
    expect(result.finishReason).toBe('stop');
  });

  it('chat() returns tool_calls', async () => {
    globalThis.fetch = mockFetch({
      id: 'chatcmpl-2',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search', arguments: '{"query":"weather"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
    });

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const result = await adapter.chat(messages);

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'call_1',
      name: 'search',
      arguments: { query: 'weather' },
    });
  });

  it('passes system messages as-is (OpenAI supports system role)', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hi' },
          finish_reason: 'stop',
        },
      ],
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    await adapter.chat(messages);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
  });

  it('throws LLMError on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } }),
    });

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    try {
      await adapter.chat(messages);
    } catch (e) {
      expect(e).toBeInstanceOf(LLMError);
      expect((e as LLMError).code).toBe('rate_limit');
      expect((e as LLMError).provider).toBe('openai-browser');
    }
  });

  it('supports custom baseURL', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-1',
      model: 'llama3',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hi' },
          finish_reason: 'stop',
        },
      ],
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'llama3',
      baseURL: 'https://api.groq.com/openai/v1/chat/completions',
    });

    await adapter.chat(messages);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('chatStream() yields tokens and done', async () => {
    globalThis.fetch = mockSSEFetch([
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      'data: [DONE]',
    ]);

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const chunks: import('../../src/types').LLMStreamChunk[] = [];
    for await (const chunk of adapter.chatStream(messages)) {
      chunks.push(chunk);
    }

    const tokens = chunks.filter((c) => c.type === 'token');
    expect(tokens).toHaveLength(2);
    expect(tokens[0].content).toBe('Hello');
    expect(tokens[1].content).toBe(' world');

    const usageChunks = chunks.filter((c) => c.type === 'usage');
    expect(usageChunks).toHaveLength(1);
    expect(usageChunks[0].usage!.totalTokens).toBe(15);

    expect(chunks[chunks.length - 1].type).toBe('done');
  });

  it('chatStream() accumulates and yields tool calls', async () => {
    globalThis.fetch = mockSSEFetch([
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"hi\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ]);

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const chunks: import('../../src/types').LLMStreamChunk[] = [];
    for await (const chunk of adapter.chatStream(messages)) {
      chunks.push(chunk);
    }

    const toolChunks = chunks.filter((c) => c.type === 'tool_call');
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0].toolCall!.name).toBe('search');
    expect(toolChunks[0].toolCall!.arguments).toEqual({ q: 'hi' });
  });

  it('sends tools in request body', async () => {
    const fetchMock = mockFetch({
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'I can help.' },
          finish_reason: 'stop',
        },
      ],
    });
    globalThis.fetch = fetchMock;

    const adapter = new BrowserOpenAIAdapter({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    await adapter.chat(messages, {
      tools: [
        {
          name: 'search',
          description: 'Search the web',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('search');
  });
});
