/**
 * LLM provider adapters — implementation behind the `agentfootprint/providers`
 * subpath (which re-exports this file).
 *
 * The standalone `agentfootprint/providers` subpath alias was removed in 4.0.0.
 * Import from the canonical subpath:
 *
 *   import { mock, anthropic, openai } from 'agentfootprint/providers';
 *
 * Pattern: Adapter (GoF) — concrete `LLMProvider` implementations that
 *          translate the agentfootprint port to a specific vendor SDK.
 * Role:    Outer ring (Hexagonal). Swappable at runtime; the Agent
 *          knows nothing about vendor specifics.
 *
 * What's here today:
 *   • `mock` / `MockProvider` — deterministic + realistic-mode mock
 *   • `ollama` / `OllamaProvider` — local models, free, no API key
 *   • `anthropic` / `AnthropicProvider` — real provider (Claude)
 *   • `openai` / `OpenAIProvider` — real provider (GPT)
 *   • `gemini` / `GeminiProvider` — Gemini on Vertex or the Gemini API
 *   • `bedrock`, `azureOpenai`, and the `browser*` variants
 *   • `foundry` / `foundryLocal` — Microsoft Foundry: a project endpoint in
 *     the cloud (Entra or key), and the on-device Foundry Local service
 *
 * The ladder these are FOR: `mock()` while you shape the logic →
 * `ollama('<model>')` for a real model that costs nothing and needs no
 * key → a paid API in production. The agent code above them does not
 * change between the three; that is the whole point of the port.
 *
 * Bring your own (BYO):
 *   For Cohere / on-prem / fine-tuned models, implement the
 *   `LLMProvider` interface (see `LLMProvider` exported from the main
 *   barrel) — `complete()` is required, `stream()` is optional. The
 *   `MockProvider` source is the canonical reference.
 */

export {
  MockProvider,
  mock,
  type MockProviderOptions,
  type MockReply,
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
  azureOpenai,
  type OpenAIProviderOptions,
  type AzureOpenAIProviderOptions,
} from './adapters/llm/OpenAIProvider.js';

export {
  ollama,
  OllamaProvider,
  OllamaUnavailableError,
  type OllamaProviderOptions,
  type ThinkLevel,
} from './adapters/llm/OllamaProvider.js';

// Microsoft Foundry, both doors (9.74.0). `foundry()` speaks a PROJECT
// endpoint's `/openai/v1` route — deployment name as the model, Entra
// credential or key as the auth; the hosted platform injects
// FOUNDRY_PROJECT_ENDPOINT so a deployed container needs zero config.
// `entraBearerToken` is deliberately NOT re-exported: it is the two Entra
// doors' shared plumbing, not a promise; vend tokens through
// `entraIdentity` (agentfootprint/security) instead.
export {
  foundry,
  foundryInferenceUrl,
  type FoundryProviderOptions,
} from './adapters/llm/FoundryProvider.js';

// The Azure credential duck-types live with the identity adapter — the
// vendor's credential shape is identity's domain; this barrel only forwards
// the names so `foundry({ credential })` can be typed without importing the
// security door.
export type {
  TokenCredentialLike,
  AccessTokenLike,
} from './adapters/identity/azure.js';

// Foundry Local: the on-device service. Fetch-only like `ollama()` — the
// service's own OpenAI-compatible `/v1` is the wire, the typed refusal
// carries the fix (`foundry server start` / `status`; the port is dynamic).
export {
  foundryLocal,
  FoundryLocalProvider,
  FoundryLocalUnavailableError,
  type FoundryLocalProviderOptions,
} from './adapters/llm/FoundryLocalProvider.js';

export {
  bedrock,
  BedrockProvider,
  type BedrockProviderOptions,
} from './adapters/llm/BedrockProvider.js';

export {
  gemini,
  GeminiProvider,
  type GeminiProviderOptions,
  type GeminiClientLike,
  type GeminiModelsLike,
  type GeminiGenerateParams,
  type GeminiGenerateConfig,
  type GeminiGenerateResponse,
  type GeminiUsageMetadata,
  type GeminiCandidate,
  type GeminiContent,
  type GeminiPart,
  type GeminiFunctionDeclaration,
} from './adapters/llm/GeminiProvider.js';

// `GoogleApiKeySource` and `GoogleDoor` are deliberately NOT re-exported here.
// The widened key type is already reachable inline on
// `GoogleGenAIConnectionOptions.apiKey` — `apiKey: () => token` compiles
// without naming it — and the door is an adapter-internal decision, not a knob.
// A name on this barrel is a promise to keep it; these two are not yet one.
export type { GoogleGenAIConnectionOptions } from './adapters/llm/googleGenAI.js';

export {
  browserAnthropic,
  BrowserAnthropicProvider,
  type BrowserAnthropicProviderOptions,
} from './adapters/llm/BrowserAnthropicProvider.js';

export {
  browserOpenai,
  BrowserOpenAIProvider,
  type BrowserOpenAIProviderOptions,
  browserAzureOpenai,
  BrowserAzureOpenAIProvider,
  type BrowserAzureOpenAIProviderOptions,
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
  // v7.8 — the optional per-call hooks a caller may hand `complete()` /
  // `stream()`. Exported here so a consumer implementing a provider off
  // this subpath can name the type in their own signature.
  LLMCallHooks,
  ResilienceReport,
} from './adapters/types.js';
