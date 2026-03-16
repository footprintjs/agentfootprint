/**
 * Provider factory functions.
 * Return ModelConfig — adapters turn these into LLMProvider instances.
 *
 * Usage:
 *   import { anthropic, openai, ollama } from 'agentfootprint';
 *   const model = anthropic('claude-sonnet-4-20250514');
 */

import type { ModelConfig, ModelOptions } from './types';

export function anthropic(
  modelId: string,
  options?: ModelOptions & { apiKey?: string },
): ModelConfig {
  return {
    provider: 'anthropic',
    modelId,
    apiKey: options?.apiKey,
    options,
  };
}

export function openai(
  modelId: string,
  options?: ModelOptions & { apiKey?: string; baseUrl?: string },
): ModelConfig {
  return {
    provider: 'openai',
    modelId,
    apiKey: options?.apiKey,
    baseUrl: options?.baseUrl,
    options,
  };
}

export function ollama(
  modelId: string,
  options?: ModelOptions & { baseUrl?: string },
): ModelConfig {
  return {
    provider: 'ollama',
    modelId,
    baseUrl: options?.baseUrl ?? 'http://localhost:11434',
    options,
  };
}

export function bedrock(modelId: string, options?: ModelOptions): ModelConfig {
  return {
    provider: 'bedrock',
    modelId,
    options,
  };
}
