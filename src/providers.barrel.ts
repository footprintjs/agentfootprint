/**
 * agentfootprint/providers — Connect to LLM providers.
 *
 * Import from here to connect your agent to Anthropic, OpenAI, Bedrock, Ollama, or mock.
 *
 * @example
 * ```typescript
 * import { mock, anthropic, createProvider } from 'agentfootprint/providers';
 *
 * // Testing — deterministic, $0
 * const provider = mock([{ content: 'Hello!' }]);
 *
 * // Production — swap one line
 * const provider = createProvider(anthropic('claude-sonnet-4-20250514'));
 * ```
 */

// Provider factories
export { anthropic, openai, ollama, bedrock } from './models';
export type { ModelConfig, ModelOptions, ModelPricing } from './models';
export { DEFAULT_PRICING, lookupPricing } from './models';

// Adapters
export { MockAdapter, mock, MockRetriever, mockRetriever, createProvider } from './adapters';
export { AnthropicAdapter, OpenAIAdapter, BedrockAdapter } from './adapters';
export { BrowserAnthropicAdapter, BrowserOpenAIAdapter } from './adapters';
export type {
  MockResponse,
  MockRetrievalResponse,
  AnthropicAdapterOptions,
  OpenAIAdapterOptions,
  BedrockAdapterOptions,
  BrowserAnthropicAdapterOptions,
  BrowserOpenAIAdapterOptions,
} from './adapters';

// Protocol adapters
export { mcpToolProvider, a2aRunner } from './adapters';
export type { MCPClient, MCPToolProviderOptions, A2AClient, A2ARunnerOptions } from './adapters';

// Provider interfaces
export type { LLMProvider, LLMCallOptions, LLMResponse, LLMStreamChunk, TokenUsage } from './types';
export type {
  PromptProvider,
  PromptContext,
  ToolProvider,
  ToolContext,
  ToolExecutionResult,
} from './core';

// Tool provider strategies
export { agentAsTool, compositeTools, gatedTools } from './providers';
export type { AgentAsToolConfig } from './providers';

// Prompt strategies
export { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from './providers';
export type { Skill, SkillBasedPromptOptions, CompositePromptOptions } from './providers';

// Message strategies
export {
  fullHistory,
  slidingWindow,
  charBudget,
  withToolPairSafety,
  summaryStrategy,
  compositeMessages,
  persistentHistory,
} from './providers';
export type {
  SlidingWindowOptions,
  CharBudgetOptions,
  SummaryStrategyOptions,
  PersistentHistoryOptions,
} from './providers';

// Memory strategies
export { InMemoryStore } from './adapters/memory/inMemory';
export type { ConversationStore, MemoryConfig } from './adapters/memory/types';
