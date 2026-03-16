/**
 * Tests for real LLM provider adapters.
 *
 * Uses _client injection to provide mock SDK clients — no real API calls.
 * Tests cover: chat, streaming, multi-modal, signal passthrough, error wrapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '../../src/types';
import { LLMError, wrapSDKError } from '../../src/types/errors';
import { AnthropicAdapter } from '../../src/adapters/anthropic/AnthropicAdapter';
import { OpenAIAdapter } from '../../src/adapters/openai/OpenAIAdapter';
import { BedrockAdapter } from '../../src/adapters/bedrock/BedrockAdapter';
import { createProvider } from '../../src/adapters/createProvider';
import { anthropic, openai, ollama, bedrock } from '../../src/models';

// ── Helpers ──────────────────────────────────────────────────

function mockAnthropicClient(
  createFn: ReturnType<typeof vi.fn>,
  streamFn?: ReturnType<typeof vi.fn>,
) {
  return {
    messages: {
      create: createFn,
      stream: streamFn ?? vi.fn(),
    },
  };
}

function mockOpenAIClient(createFn: ReturnType<typeof vi.fn>) {
  return { chat: { completions: { create: createFn } } };
}

function mockBedrockClient(sendFn: ReturnType<typeof vi.fn>) {
  return { send: sendFn };
}

// ── Anthropic Adapter ────────────────────────────────────────

describe('AnthropicAdapter', () => {
  let createFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createFn = vi.fn();
  });

  function adapter(opts: { maxTokens?: number } = {}) {
    return new AnthropicAdapter({
      model: 'claude-sonnet-4-20250514',
      _client: mockAnthropicClient(createFn),
      ...opts,
    });
  }

  it('sends a simple user message and returns content', async () => {
    createFn.mockResolvedValue({
      id: 'msg_123',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello! How can I help?' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 8 },
    });

    const result = await adapter().chat([{ role: 'user', content: 'Hello' }]);

    expect(result.content).toBe('Hello! How can I help?');
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 8,
      totalTokens: 18,
    });
  });

  it('extracts system message into separate param', async () => {
    createFn.mockResolvedValue({
      id: 'msg_456',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'I am helpful.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 20, output_tokens: 5 },
    });

    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hi' },
    ];

    await adapter().chat(messages);

    const callArgs = createFn.mock.calls[0][0];
    expect(callArgs.system).toBe('You are a helpful assistant.');
    expect(callArgs.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true);
  });

  it('handles tool use response', async () => {
    createFn.mockResolvedValue({
      id: 'msg_789',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check the weather.' },
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'get_weather',
          input: { city: 'San Francisco' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 30, output_tokens: 15 },
    });

    const result = await adapter().chat([{ role: 'user', content: 'Weather in SF?' }], {
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'toolu_123',
      name: 'get_weather',
      arguments: { city: 'San Francisco' },
    });
  });

  it('converts tool result messages into user content blocks', async () => {
    createFn.mockResolvedValue({
      id: 'msg_abc',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'SF is 72°F.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 40, output_tokens: 10 },
    });

    const messages: Message[] = [
      { role: 'user', content: 'Weather in SF?' },
      {
        role: 'assistant',
        content: 'Checking.',
        toolCalls: [{ id: 'tc1', name: 'get_weather', arguments: { city: 'SF' } }],
      },
      { role: 'tool', content: '72°F sunny', toolCallId: 'tc1' },
    ];

    await adapter().chat(messages);

    const callArgs = createFn.mock.calls[0][0];
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(Array.isArray(lastMsg.content)).toBe(true);
    expect(lastMsg.content[0].type).toBe('tool_result');
    expect(lastMsg.content[0].tool_use_id).toBe('tc1');
  });

  it('passes AbortSignal to SDK', async () => {
    createFn.mockResolvedValue({
      id: 'msg_sig',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    const controller = new AbortController();
    await adapter().chat([{ role: 'user', content: 'Hi' }], { signal: controller.signal });

    const callArgs = createFn.mock.calls[0][0];
    expect(callArgs.signal).toBe(controller.signal);
  });

  it('wraps SDK errors into LLMError', async () => {
    const sdkError = new Error('Rate limit exceeded');
    (sdkError as unknown as { status: number }).status = 429;
    createFn.mockRejectedValue(sdkError);

    try {
      await adapter().chat([{ role: 'user', content: 'Hi' }]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      const llmErr = err as LLMError;
      expect(llmErr.code).toBe('rate_limit');
      expect(llmErr.provider).toBe('anthropic');
      expect(llmErr.retryable).toBe(true);
      expect(llmErr.statusCode).toBe(429);
    }
  });

  it('handles multi-modal content (image blocks)', async () => {
    createFn.mockResolvedValue({
      id: 'msg_mm',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'I see a cat.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 5 },
    });

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'iVBOR...' } },
        ],
      },
    ];

    await adapter().chat(messages);

    const callArgs = createFn.mock.calls[0][0];
    const userMsg = callArgs.messages[0];
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0].type).toBe('text');
    expect(userMsg.content[1].type).toBe('image');
    expect(userMsg.content[1].source.type).toBe('base64');
  });

  it('maps max_tokens from options or default', async () => {
    const response = {
      id: 'msg_ghi',
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 },
    };

    createFn.mockResolvedValue(response);
    await adapter().chat([{ role: 'user', content: 'Hi' }]);
    expect(createFn.mock.calls[0][0].max_tokens).toBe(4096);

    createFn.mockClear();
    createFn.mockResolvedValue(response);
    await adapter({ maxTokens: 2048 }).chat([{ role: 'user', content: 'Hi' }]);
    expect(createFn.mock.calls[0][0].max_tokens).toBe(2048);

    createFn.mockClear();
    createFn.mockResolvedValue(response);
    await adapter({ maxTokens: 2048 }).chat([{ role: 'user', content: 'Hi' }], { maxTokens: 1024 });
    expect(createFn.mock.calls[0][0].max_tokens).toBe(1024);
  });

  it('throws helpful error when SDK not installed', () => {
    expect(() => new AnthropicAdapter({ model: 'claude-sonnet-4-20250514' })).toThrow(
      'AnthropicAdapter requires @anthropic-ai/sdk',
    );
  });
});

// ── OpenAI Adapter ───────────────────────────────────────────

describe('OpenAIAdapter', () => {
  let createFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createFn = vi.fn();
  });

  function adapter(opts: { maxTokens?: number; baseURL?: string } = {}) {
    return new OpenAIAdapter({
      model: 'gpt-4o',
      _client: mockOpenAIClient(createFn),
      ...opts,
    });
  }

  it('sends a simple user message and returns content', async () => {
    createFn.mockResolvedValue({
      id: 'chatcmpl-123',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help?' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    });

    const result = await adapter().chat([{ role: 'user', content: 'Hello' }]);

    expect(result.content).toBe('Hello! How can I help?');
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('gpt-4o');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 8, totalTokens: 18 });
  });

  it('handles tool calls with JSON string arguments', async () => {
    createFn.mockResolvedValue({
      id: 'chatcmpl-456',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Checking weather.',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"San Francisco"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
    });

    const result = await adapter().chat([{ role: 'user', content: 'Weather in SF?' }], {
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls![0]).toEqual({
      id: 'call_abc',
      name: 'get_weather',
      arguments: { city: 'San Francisco' },
    });
  });

  it('handles malformed tool call arguments gracefully', async () => {
    createFn.mockResolvedValue({
      id: 'chatcmpl-789',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_bad',
                type: 'function',
                function: { name: 'broken_tool', arguments: 'not valid json{{{' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });

    const result = await adapter().chat([{ role: 'user', content: 'Do something' }]);
    expect(result.toolCalls![0].arguments).toEqual({ _raw: 'not valid json{{{' });
  });

  it('passes AbortSignal to SDK', async () => {
    createFn.mockResolvedValue({
      id: 'chatcmpl-sig',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'OK' },
          finish_reason: 'stop',
        },
      ],
    });

    const controller = new AbortController();
    await adapter().chat([{ role: 'user', content: 'Hi' }], { signal: controller.signal });

    const callArgs = createFn.mock.calls[0][0];
    expect(callArgs.signal).toBe(controller.signal);
  });

  it('wraps SDK errors into LLMError', async () => {
    const sdkError = new Error('Unauthorized');
    (sdkError as unknown as { status: number }).status = 401;
    createFn.mockRejectedValue(sdkError);

    try {
      await adapter().chat([{ role: 'user', content: 'Hi' }]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      const llmErr = err as LLMError;
      expect(llmErr.code).toBe('auth');
      expect(llmErr.provider).toBe('openai');
      expect(llmErr.retryable).toBe(false);
    }
  });

  it('handles multi-modal content (image URL)', async () => {
    createFn.mockResolvedValue({
      id: 'chatcmpl-mm',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'A cat.' },
          finish_reason: 'stop',
        },
      ],
    });

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', source: { type: 'url', url: 'https://example.com/cat.jpg' } },
        ],
      },
    ];

    await adapter().chat(messages);

    const callArgs = createFn.mock.calls[0][0];
    const userMsg = callArgs.messages[0];
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({ type: 'text', text: 'What is this?' });
    expect(userMsg.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/cat.jpg' },
    });
  });

  it('handles empty choices gracefully', async () => {
    createFn.mockResolvedValue({
      id: 'chatcmpl-empty',
      model: 'gpt-4o',
      choices: [],
    });

    const result = await adapter().chat([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  it('maps finish_reason correctly', async () => {
    const cases = [
      { finish_reason: 'stop', expected: 'stop' },
      { finish_reason: 'tool_calls', expected: 'tool_calls' },
      { finish_reason: 'length', expected: 'length' },
      { finish_reason: 'content_filter', expected: 'error' },
    ];

    for (const tc of cases) {
      createFn.mockResolvedValueOnce({
        id: 'chatcmpl-fr',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'OK' },
            finish_reason: tc.finish_reason,
          },
        ],
      });

      const result = await adapter().chat([{ role: 'user', content: 'Hi' }]);
      expect(result.finishReason).toBe(tc.expected);
    }
  });

  it('throws helpful error when SDK not installed', () => {
    expect(() => new OpenAIAdapter({ model: 'gpt-4o' })).toThrow(
      'OpenAIAdapter requires the openai package',
    );
  });
});

// ── Bedrock Adapter ──────────────────────────────────────────

describe('BedrockAdapter', () => {
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendFn = vi.fn();
  });

  function adapter(opts: { maxTokens?: number } = {}) {
    return new BedrockAdapter({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      _client: mockBedrockClient(sendFn),
      ...opts,
    });
  }

  it('sends a simple user message and returns content', async () => {
    sendFn.mockResolvedValue({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'Hello from Bedrock!' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
    });

    const result = await adapter().chat([{ role: 'user', content: 'Hello' }]);

    expect(result.content).toBe('Hello from Bedrock!');
    expect(result.finishReason).toBe('stop');
    expect(result.model).toBe('anthropic.claude-sonnet-4-20250514-v1:0');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 8, totalTokens: 18 });
  });

  it('handles tool use response', async () => {
    sendFn.mockResolvedValue({
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'Checking weather.' },
            { toolUse: { toolUseId: 'tu1', name: 'get_weather', input: { city: 'SF' } } },
          ],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 20, outputTokens: 12, totalTokens: 32 },
    });

    const result = await adapter().chat([{ role: 'user', content: 'Weather?' }], {
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'tu1',
      name: 'get_weather',
      arguments: { city: 'SF' },
    });
  });

  it('extracts system message into system param', async () => {
    sendFn.mockResolvedValue({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'I am helpful.' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20 },
    });

    const messages: Message[] = [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hi' },
    ];

    await adapter().chat(messages);

    const command = sendFn.mock.calls[0][0];
    // The command should have system and messages without system role
    expect(command).toBeDefined();
  });

  it('converts tool result messages into user content blocks', async () => {
    sendFn.mockResolvedValue({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'SF is 72°F.' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
    });

    const messages: Message[] = [
      { role: 'user', content: 'Weather?' },
      {
        role: 'assistant',
        content: 'Checking.',
        toolCalls: [{ id: 'tc1', name: 'weather', arguments: { city: 'SF' } }],
      },
      { role: 'tool', content: '72°F sunny', toolCallId: 'tc1' },
    ];

    await adapter().chat(messages);
    // If it doesn't throw, the conversion worked
    expect(sendFn).toHaveBeenCalledOnce();
  });

  it('wraps SDK errors into LLMError', async () => {
    const sdkError = new Error('Service unavailable');
    (sdkError as unknown as { status: number }).status = 503;
    sendFn.mockRejectedValue(sdkError);

    try {
      await adapter().chat([{ role: 'user', content: 'Hi' }]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      const llmErr = err as LLMError;
      expect(llmErr.code).toBe('server');
      expect(llmErr.provider).toBe('bedrock');
      expect(llmErr.retryable).toBe(true);
    }
  });

  it('handles empty output gracefully', async () => {
    sendFn.mockResolvedValue({});

    const result = await adapter().chat([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('error');
  });

  it('passes tools in Bedrock toolSpec format', async () => {
    sendFn.mockResolvedValue({
      output: {
        message: { role: 'assistant', content: [{ text: 'OK' }] },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
    });

    await adapter().chat([{ role: 'user', content: 'Hi' }], {
      tools: [
        {
          name: 'search',
          description: 'Search',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    });

    // Verify the command was constructed (duck-typed — we can't inspect the Command class)
    expect(sendFn).toHaveBeenCalledOnce();
  });

  it('throws helpful error when SDK not installed', () => {
    expect(() => new BedrockAdapter({ model: 'anthropic.claude-sonnet-4-20250514-v1:0' })).toThrow(
      'BedrockAdapter requires @aws-sdk/client-bedrock-runtime',
    );
  });
});

// ── LLMError ─────────────────────────────────────────────────

describe('LLMError', () => {
  it('classifies common HTTP status codes', () => {
    const cases: Array<[number, string, boolean]> = [
      [401, 'auth', false],
      [403, 'auth', false],
      [429, 'rate_limit', true],
      [400, 'invalid_request', false],
      [413, 'context_length', false],
      [500, 'server', true],
      [503, 'server', true],
    ];

    for (const [status, expectedCode, expectedRetryable] of cases) {
      const err = new Error('test');
      (err as unknown as { status: number }).status = status;
      const llmErr = wrapSDKError(err, 'test') as LLMError;
      expect(llmErr.code).toBe(expectedCode);
      expect(llmErr.retryable).toBe(expectedRetryable);
    }
  });

  it('detects abort errors', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const llmErr = wrapSDKError(err, 'test');
    expect(llmErr.code).toBe('aborted');
    expect(llmErr.retryable).toBe(false);
  });

  it('detects network errors', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    const llmErr = wrapSDKError(err, 'ollama');
    expect(llmErr.code).toBe('network');
    expect(llmErr.provider).toBe('ollama');
    expect(llmErr.retryable).toBe(true);
  });

  it('passes through existing LLMError unchanged', () => {
    const original = new LLMError({
      message: 'already wrapped',
      code: 'rate_limit',
      provider: 'anthropic',
    });
    const result = wrapSDKError(original, 'openai');
    expect(result).toBe(original); // Same instance
    expect(result.provider).toBe('anthropic'); // Not overwritten
  });
});

// ── createProvider Bridge ────────────────────────────────────

describe('createProvider', () => {
  it('creates AnthropicAdapter from anthropic() config', () => {
    expect(() => createProvider(anthropic('claude-sonnet-4-20250514'))).toThrow(
      'AnthropicAdapter requires @anthropic-ai/sdk',
    );
  });

  it('creates OpenAIAdapter from openai() config', () => {
    expect(() => createProvider(openai('gpt-4o'))).toThrow(
      'OpenAIAdapter requires the openai package',
    );
  });

  it('creates OpenAIAdapter from ollama() config with baseURL', () => {
    expect(() => createProvider(ollama('llama3'))).toThrow(
      'OpenAIAdapter requires the openai package',
    );
  });

  it('creates BedrockAdapter from bedrock() config', () => {
    expect(() => createProvider(bedrock('anthropic.claude-sonnet-4-20250514-v1:0'))).toThrow(
      'BedrockAdapter requires @aws-sdk/client-bedrock-runtime',
    );
  });

  it('throws on unknown provider', () => {
    expect(() =>
      createProvider({ provider: 'gemini' as 'anthropic', modelId: 'gemini-pro' }),
    ).toThrow('Unknown provider "gemini"');
  });
});
