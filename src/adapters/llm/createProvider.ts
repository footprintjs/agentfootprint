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
 *   const kind = (process.env.LLM_PROVIDER ?? 'anthropic') as ProviderKind;
 *   const provider = createProvider({
 *     kind,
 *     apiKey: process.env.LLM_API_KEY,
 *     defaultModel: process.env.LLM_MODEL,
 *   } as CreateProviderOptions);
 *
 * For provider-specific options (Bedrock region, Ollama baseUrl, Browser
 * apiUrl, etc.) construct the underlying factory directly — this
 * helper deliberately exposes only the common subset.
 */

import type { LLMProvider } from '../types.js';
import { mock, type MockProviderOptions } from './MockProvider.js';
import { anthropic, type AnthropicProviderOptions } from './AnthropicProvider.js';
import { openai, azureOpenai, type OpenAIProviderOptions } from './OpenAIProvider.js';
import { ollama, type OllamaProviderOptions } from './OllamaProvider.js';
import { bedrock, type BedrockProviderOptions } from './BedrockProvider.js';
import { gemini, type GeminiProviderOptions } from './GeminiProvider.js';
import {
  browserAnthropic,
  type BrowserAnthropicProviderOptions,
} from './BrowserAnthropicProvider.js';
import { browserOpenai, type BrowserOpenAIProviderOptions } from './BrowserOpenAIProvider.js';

/** Built-in provider kinds. Custom providers don't go through this factory. */
export type ProviderKind =
  | 'mock'
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'bedrock'
  | 'gemini'
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
  | ({ readonly kind: 'ollama' } & OllamaProviderOptions)
  | ({ readonly kind: 'bedrock' } & BedrockProviderOptions)
  | ({ readonly kind: 'gemini' } & GeminiProviderOptions)
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
    case 'gemini':
      return gemini(options);
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

/** What `providerFromEnv()` resolved: the provider + the `model` to pass to
 *  `Agent.create({ provider, model })`, and which `kind` was detected. */
export interface ProviderFromEnv {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly kind: 'ollama' | 'azure-openai' | 'anthropic' | 'openai' | 'mock';
}

/**
 * Resolve an `LLMProvider` from environment variables — drop your company's
 * values in `.env` and the right provider is configured automatically, with no
 * code branching. (Node only — reads `process.env`; the vendor SDK is lazy-loaded
 * only for the detected provider.)
 *
 * Detection order (first match wins):
 *   1. **Ollama (local)** — `OLLAMA_MODEL` names a model, e.g. `qwen3`
 *      [+ `OLLAMA_HOST` for a runtime that isn't on localhost]
 *   2. **Azure OpenAI** — `AZURE_OPENAI_API_KEY` + (`AZURE_OPENAI_ENDPOINT` |
 *      `OPENAI_BASE_URL`) [+ `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT`|`MODEL_NAME`]
 *   3. **Anthropic** — `ANTHROPIC_API_KEY`
 *   4. **OpenAI** — `OPENAI_API_KEY`
 * Otherwise throws (or returns the mock when `{ fallbackToMock: true }`).
 *
 * **Why the local model goes first.** Every other arm triggers on a
 * CREDENTIAL, and credentials arrive in a shell by accident all the time —
 * a key exported in `.zshrc` two months ago for something else. `OLLAMA_MODEL`
 * triggers on a NAME you had to choose and type, so its presence is a
 * declaration rather than a leftover: someone who writes `OLLAMA_MODEL=qwen3`
 * has said which model they want this run to use, and honoring the cloud key
 * instead would both ignore them and cost them money. (`OLLAMA_HOST` alone is
 * NOT a trigger — people export it just to run Ollama, and it must not hijack
 * an app that never asked for a local model.)
 *
 * **No probing.** This function reads environment variables and nothing else.
 * It never opens a socket to see whether a daemon is up — its answer stays
 * deterministic, instant, and identical on a laptop and in CI. If `OLLAMA_MODEL`
 * is set and the daemon is down, you get the provider, and the refusal arrives
 * from the call itself with `ollama serve` in the message.
 *
 * @example
 *   import { providerFromEnv } from 'agentfootprint';
 *   const { provider, model, kind } = providerFromEnv({ fallbackToMock: true });
 *   const agent = Agent.create({ provider, model }).build();
 */
export function providerFromEnv(opts: { readonly fallbackToMock?: boolean } = {}): ProviderFromEnv {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<
    string,
    string | undefined
  >;
  if (env.OLLAMA_MODEL) {
    return {
      provider: ollama(env.OLLAMA_MODEL, {
        ...(env.OLLAMA_HOST && { baseUrl: env.OLLAMA_HOST }),
      }),
      model: env.OLLAMA_MODEL,
      kind: 'ollama',
    };
  }
  const azureEndpoint = env.AZURE_OPENAI_ENDPOINT ?? env.OPENAI_BASE_URL;
  if (env.AZURE_OPENAI_API_KEY && azureEndpoint) {
    return {
      provider: azureOpenai({
        endpoint: azureEndpoint,
        apiKey: env.AZURE_OPENAI_API_KEY,
        ...(env.AZURE_OPENAI_API_VERSION && { apiVersion: env.AZURE_OPENAI_API_VERSION }),
        ...((env.AZURE_OPENAI_DEPLOYMENT ?? env.MODEL_NAME) && {
          deployment: env.AZURE_OPENAI_DEPLOYMENT ?? env.MODEL_NAME,
        }),
      }),
      model: 'azure',
      kind: 'azure-openai',
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      model: env.LLM_MODEL ?? 'anthropic',
      kind: 'anthropic',
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      provider: openai({ apiKey: env.OPENAI_API_KEY }),
      model: env.LLM_MODEL ?? 'openai',
      kind: 'openai',
    };
  }
  if (opts.fallbackToMock) {
    return {
      provider: mock({ reply: 'mock reply (no provider env set)' }),
      model: 'mock',
      kind: 'mock',
    };
  }
  throw new Error(
    'providerFromEnv: no provider declared in the environment. Set one of:\n' +
      '  • Ollama:    OLLAMA_MODEL (a local model, e.g. qwen3 — free, no API key)\n' +
      '  • Azure:     AZURE_OPENAI_API_KEY + (AZURE_OPENAI_ENDPOINT | OPENAI_BASE_URL)\n' +
      '               + AZURE_OPENAI_API_VERSION + (AZURE_OPENAI_DEPLOYMENT | MODEL_NAME)\n' +
      '  • Anthropic: ANTHROPIC_API_KEY\n' +
      '  • OpenAI:    OPENAI_API_KEY\n' +
      '  …or call providerFromEnv({ fallbackToMock: true }).',
  );
}
