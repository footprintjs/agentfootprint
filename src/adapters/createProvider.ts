/**
 * createProvider — bridges ModelConfig → LLMProvider.
 *
 * Resolves a ModelConfig (from anthropic(), openai(), ollama(), bedrock())
 * into the appropriate adapter instance.
 *
 * Usage:
 *   import { createProvider, anthropic } from 'agentfootprint';
 *
 *   // Config-based (simple DX):
 *   const provider = createProvider(anthropic('claude-sonnet-4-20250514'));
 *
 *   // With options:
 *   const provider = createProvider(openai('gpt-4o', { apiKey: 'sk-...' }));
 *
 *   // Ollama (auto-configured):
 *   const provider = createProvider(ollama('llama3'));
 */

import type { LLMProvider } from '../types';
import type { ModelConfig } from '../models';
import { AnthropicAdapter } from './anthropic/AnthropicAdapter';
import { OpenAIAdapter } from './openai/OpenAIAdapter';
import { BedrockAdapter } from './bedrock/BedrockAdapter';
import { MockAdapter } from './mock/MockAdapter';

/**
 * Create an LLMProvider from a ModelConfig.
 *
 * Maps provider factories (anthropic(), openai(), ollama(), bedrock())
 * to their real adapter implementations.
 */
export function createProvider(
  config: ModelConfig & { _client?: unknown },
): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicAdapter({
        model: config.modelId,
        apiKey: config.apiKey,
        maxTokens: config.options?.maxTokens,
        _client: config._client,
      });

    case 'openai':
      return new OpenAIAdapter({
        model: config.modelId,
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        maxTokens: config.options?.maxTokens,
        _client: config._client,
      });

    case 'ollama':
      return new OpenAIAdapter({
        model: config.modelId,
        baseURL: config.baseUrl ?? 'http://localhost:11434/v1',
        maxTokens: config.options?.maxTokens,
        _client: config._client,
      });

    case 'bedrock':
      return new BedrockAdapter({
        model: config.modelId,
        maxTokens: config.options?.maxTokens,
        _client: config._client,
      });

    case 'mock':
      return new MockAdapter([]);

    default:
      throw new Error(
        `Unknown provider "${config.provider}". ` +
          'Supported: anthropic, openai, ollama, bedrock, mock.',
      );
  }
}
