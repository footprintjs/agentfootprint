/**
 * agentfootprint/providers — LLM provider adapters.
 *
 * Pattern: Adapter (GoF) — concrete `LLMProvider` implementations that
 *          translate the agentfootprint port to a specific vendor SDK.
 * Role:    Outer ring (Hexagonal). Swappable at runtime; the Agent
 *          knows nothing about vendor specifics.
 *
 * What's here today:
 *   • `mock` / `MockProvider` — deterministic + realistic-mode mock
 *   • `anthropic` / `AnthropicProvider` — real provider (Claude)
 *   • `openai` / `OpenAIProvider` — real provider (GPT)
 *
 * Bring your own (BYO):
 *   For Bedrock / Ollama / Cohere / on-prem / fine-tuned models,
 *   implement the `LLMProvider` interface (see `LLMProvider` exported
 *   from the main barrel) — `complete()` is required, `stream()` is
 *   optional. The `MockProvider` source is the canonical reference.
 */

export {
  MockProvider,
  mock,
  type MockProviderOptions,
  type LatencyMs,
} from './adapters/llm/MockProvider.js';

export {
  anthropic,
  AnthropicProvider,
  type AnthropicProviderOptions,
} from './adapters/llm/AnthropicProvider.js';

export {
  openai,
  OpenAIProvider,
  ollama,
  type OpenAIProviderOptions,
} from './adapters/llm/OpenAIProvider.js';

export {
  bedrock,
  BedrockProvider,
  type BedrockProviderOptions,
} from './adapters/llm/BedrockProvider.js';

export {
  browserAnthropic,
  BrowserAnthropicProvider,
  type BrowserAnthropicProviderOptions,
} from './adapters/llm/BrowserAnthropicProvider.js';

export {
  browserOpenai,
  BrowserOpenAIProvider,
  type BrowserOpenAIProviderOptions,
} from './adapters/llm/BrowserOpenAIProvider.js';

export {
  createProvider,
  type ProviderKind,
  type CreateProviderOptions,
} from './adapters/llm/createProvider.js';

export type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMChunk,
  LLMMessage,
  LLMToolSchema,
} from './adapters/types.js';
