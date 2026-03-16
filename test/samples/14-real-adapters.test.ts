/**
 * Sample 14: Real LLM Adapters + createProvider Bridge
 *
 * Shows how to use AnthropicAdapter, OpenAIAdapter, BedrockAdapter
 * directly — and how createProvider() connects model config factories
 * (anthropic(), openai(), ollama(), bedrock()) to adapter instances.
 *
 * All tests inject mock clients via `_client` so they run in CI
 * without real API keys or SDK packages installed.
 */
import { describe, it, expect } from 'vitest';
import {
  AnthropicAdapter,
  OpenAIAdapter,
  BedrockAdapter,
  createProvider,
} from '../../src/adapters';
import { anthropic, openai, ollama, bedrock } from '../../src/models';
import { userMessage, systemMessage } from '../../src/types';

// ── Mock SDK Clients ────────────────────────────────────────

function mockAnthropicClient(response: Record<string, unknown> = {}) {
  return {
    messages: {
      create: async () => ({
        id: 'msg_mock',
        model: 'claude-sonnet-4-20250514',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        ...response,
      }),
    },
  };
}

function mockOpenAIClient(response: Record<string, unknown> = {}) {
  return {
    chat: {
      completions: {
        create: async () => ({
          id: 'chatcmpl-mock',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from GPT', ...response },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  };
}

function mockBedrockClient(response: Record<string, unknown> = {}) {
  return {
    send: async () => ({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'Hello from Bedrock' }],
        },
      },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      ...response,
    }),
  };
}

describe('Sample 14: Real LLM Adapters', () => {
  // ── Direct Adapter Usage ──────────────────────────────────

  describe('AnthropicAdapter', () => {
    it('sends messages and returns normalized response', async () => {
      const adapter = new AnthropicAdapter({
        model: 'claude-sonnet-4-20250514',
        _client: mockAnthropicClient(),
      });

      const result = await adapter.chat([userMessage('Hi')]);

      expect(result.content).toBe('Hello from Claude');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });

    it('extracts system messages from the conversation', async () => {
      let capturedParams: Record<string, unknown> | undefined;
      const client = {
        messages: {
          create: async (params: Record<string, unknown>) => {
            capturedParams = params;
            return {
              id: 'msg_mock',
              model: 'claude-sonnet-4-20250514',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 5, output_tokens: 2 },
            };
          },
        },
      };

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', _client: client });
      await adapter.chat([systemMessage('Be helpful'), userMessage('Hi')]);

      // System message extracted to top-level `system` param
      expect(capturedParams?.system).toBe('Be helpful');
      const msgs = capturedParams?.messages as Array<{ role: string }>;
      expect(msgs.every((m) => m.role !== 'system')).toBe(true);
    });

    it('handles tool use responses', async () => {
      const client = mockAnthropicClient({
        content: [
          { type: 'text', text: 'Let me search.' },
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'search',
            input: { query: 'weather' },
          },
        ],
        stop_reason: 'tool_use',
      });

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', _client: client });
      const result = await adapter.chat([userMessage('Search for weather')]);

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'toolu_123',
        name: 'search',
        arguments: { query: 'weather' },
      });
    });
  });

  describe('OpenAIAdapter', () => {
    it('sends messages and returns normalized response', async () => {
      const adapter = new OpenAIAdapter({
        model: 'gpt-4o',
        _client: mockOpenAIClient(),
      });

      const result = await adapter.chat([userMessage('Hi')]);

      expect(result.content).toBe('Hello from GPT');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });

    it('handles tool calls', async () => {
      const client = mockOpenAIClient({
        content: null,
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'calculator', arguments: '{"expr":"2+2"}' },
          },
        ],
      });

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', _client: client });
      const result = await adapter.chat([userMessage('Calculate 2+2')], {
        tools: [{ name: 'calculator', description: 'Math', inputSchema: { type: 'object' } }],
      });

      expect(result.finishReason).toBe('stop');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_abc',
        name: 'calculator',
        arguments: { expr: '2+2' },
      });
    });
  });

  describe('BedrockAdapter', () => {
    it('sends messages and returns normalized response', async () => {
      const adapter = new BedrockAdapter({
        model: 'anthropic.claude-3-sonnet-20240229-v1:0',
        region: 'us-east-1',
        _client: mockBedrockClient(),
      });

      const result = await adapter.chat([userMessage('Hi')]);

      expect(result.content).toBe('Hello from Bedrock');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });
  });

  // ── createProvider Bridge ─────────────────────────────────

  describe('createProvider()', () => {
    it('connects anthropic() config to AnthropicAdapter', () => {
      const config = anthropic('claude-sonnet-4-20250514');
      const provider = createProvider({ ...config, _client: mockAnthropicClient() });
      expect(provider).toBeInstanceOf(AnthropicAdapter);
    });

    it('connects openai() config to OpenAIAdapter', () => {
      const config = openai('gpt-4o');
      const provider = createProvider({ ...config, _client: mockOpenAIClient() });
      expect(provider).toBeInstanceOf(OpenAIAdapter);
    });

    it('connects ollama() config to OpenAIAdapter with baseURL', () => {
      const config = ollama('llama3');
      const provider = createProvider({ ...config, _client: mockOpenAIClient() });
      // Ollama uses OpenAI-compatible API
      expect(provider).toBeInstanceOf(OpenAIAdapter);
    });

    it('connects bedrock() config to BedrockAdapter', () => {
      const config = bedrock('anthropic.claude-3-sonnet-20240229-v1:0');
      const provider = createProvider({ ...config, _client: mockBedrockClient() });
      expect(provider).toBeInstanceOf(BedrockAdapter);
    });

    it('full round-trip: config → provider → chat', async () => {
      const config = openai('gpt-4o');
      const provider = createProvider({ ...config, _client: mockOpenAIClient() });
      const result = await provider.chat([userMessage('Hello')]);
      expect(result.content).toBe('Hello from GPT');
    });
  });
});
