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
 *
 *   // Bedrock with region:
 *   const provider = createProvider(bedrock('anthropic.claude-sonnet-4-20250514-v1:0', { region: 'us-east-1' }));
 */

import type { LLMProvider } from '../types';
import type { ModelConfig } from '../models';
import { AnthropicAdapter } from './anthropic/AnthropicAdapter';
import { OpenAIAdapter } from './openai/OpenAIAdapter';
import { BedrockAdapter } from './bedrock/BedrockAdapter';
import { MockAdapter } from './mock/MockAdapter';

/**
 * Check if the value is already an LLMProvider (has a `.chat` method).
 * Used for auto-detection in Agent.create(), LLMCall.create(), etc.
 */
export function isLLMProvider(value: unknown): value is LLMProvider {
  return (
    typeof value === 'object' && value !== null && typeof (value as LLMProvider).chat === 'function'
  );
}

/**
 * Resolve a provider-or-config to an LLMProvider.
 *
 * Accepts either an LLMProvider directly or a ModelConfig (from anthropic(), openai(), etc.).
 * This enables:
 *   Agent.create({ provider: anthropic('claude-sonnet-4-20250514') })
 * without wrapping in createProvider().
 */
export function resolveProvider(providerOrConfig: LLMProvider | ModelConfig): LLMProvider {
  if (isLLMProvider(providerOrConfig)) return providerOrConfig;
  return createProvider(providerOrConfig as ModelConfig & { _client?: unknown });
}

/**
 * Create an LLMProvider from a ModelConfig.
 *
 * Maps provider factories (anthropic(), openai(), ollama(), bedrock())
 * to their real adapter implementations.
 */
export function createProvider(config: ModelConfig & { _client?: unknown }): LLMProvider {
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
      try {
        return new OpenAIAdapter({
          model: config.modelId,
          baseURL: config.baseUrl ?? 'http://localhost:11434/v1',
          maxTokens: config.options?.maxTokens,
          _client: config._client,
        });
      } catch (err) {
        // OpenAIAdapter throws its own clear message if 'openai' package is missing.
        // Re-wrap to mention Ollama specifically so the user knows which adapter failed.
        if (err instanceof Error && err.message.includes('openai')) {
          throw new Error(
            'Ollama adapter requires the "openai" package (OpenAI-compatible API).\n' +
              'Install it: npm install openai',
          );
        }
        throw err;
      }

    case 'bedrock':
      return new BedrockAdapter({
        model: config.modelId,
        region: config.region,
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
