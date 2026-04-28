/**
 * createProvider — by-name factory for any built-in LLMProvider.
 *
 * Pattern: Abstract Factory (GoF) over the concrete provider factories.
 * Role:    Convenience entry point. Useful for config-driven setups
 *          where the provider is chosen at runtime (env var, feature
 *          flag, tenant preference).
 * Emits:   N/A.
 *
 * @example
 *   const provider = createProvider({
 *     kind: process.env.LLM_PROVIDER ?? 'mock',
 *     apiKey: process.env.LLM_API_KEY,
 *     defaultModel: process.env.LLM_MODEL,
 *   });
 *
 * For provider-specific options (Bedrock region, Ollama host, Browser
 * apiUrl, etc.) construct the underlying factory directly — this
 * helper deliberately exposes only the common subset.
 */

import type { LLMProvider } from '../types.js';
import { mock, type MockProviderOptions } from './MockProvider.js';
import { anthropic, type AnthropicProviderOptions } from './AnthropicProvider.js';
import { openai, ollama, type OpenAIProviderOptions } from './OpenAIProvider.js';
import { bedrock, type BedrockProviderOptions } from './BedrockProvider.js';
import {
  browserAnthropic,
  type BrowserAnthropicProviderOptions,
} from './BrowserAnthropicProvider.js';
import {
  browserOpenai,
  type BrowserOpenAIProviderOptions,
} from './BrowserOpenAIProvider.js';

/** Built-in provider kinds. Custom providers don't go through this factory. */
export type ProviderKind =
  | 'mock'
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'bedrock'
  | 'browser-anthropic'
  | 'browser-openai';

/**
 * Common subset of options accepted across all built-in providers.
 * Provider-specific keys (region for Bedrock, host for Ollama,
 * organization for OpenAI, apiUrl for browser) are passed through
 * verbatim — TypeScript narrows by `kind`.
 */
export type CreateProviderOptions =
  | ({ readonly kind: 'mock' } & MockProviderOptions)
  | ({ readonly kind: 'anthropic' } & AnthropicProviderOptions)
  | ({ readonly kind: 'openai' } & OpenAIProviderOptions)
  | ({ readonly kind: 'ollama' } & OpenAIProviderOptions & { readonly host?: string })
  | ({ readonly kind: 'bedrock' } & BedrockProviderOptions)
  | ({ readonly kind: 'browser-anthropic' } & BrowserAnthropicProviderOptions)
  | ({ readonly kind: 'browser-openai' } & BrowserOpenAIProviderOptions);

/**
 * Build any built-in LLMProvider from a tagged options object.
 */
export function createProvider(options: CreateProviderOptions): LLMProvider {
  switch (options.kind) {
    case 'mock':
      return mock(options);
    case 'anthropic':
      return anthropic(options);
    case 'openai':
      return openai(options);
    case 'ollama':
      return ollama(options);
    case 'bedrock':
      return bedrock(options);
    case 'browser-anthropic':
      return browserAnthropic(options);
    case 'browser-openai':
      return browserOpenai(options);
    default: {
      // Exhaustiveness check — TypeScript will surface a missing case here.
      const _exhaustive: never = options;
      throw new Error(
        `createProvider: unknown kind ${JSON.stringify((_exhaustive as { kind: string }).kind)}`,
      );
    }
  }
}
