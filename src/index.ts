/**
 * agentfootprint — The explainable agent framework.
 *
 * Core: builders, tools, providers, messages, types.
 *
 * Focused capabilities (also importable from subpaths):
 *   agentfootprint/instructions  → Conditional context injection
 *   agentfootprint/observe       → Monitor execution (recorders)
 *   agentfootprint/resilience    → Retry, fallback, circuit breaker
 *   agentfootprint/security      → Tool gating, permissions
 *   agentfootprint/explain       → Narrative, grounding analysis
 *   agentfootprint/stream        → Real-time lifecycle events
 */

// ── Concepts (Builders + Runners) ───────────────────────────
export {
  Agent,
  AgentRunner,
  LLMCall,
  LLMCallRunner,
  RAG,
  RAGRunner,
  FlowChart,
  FlowChartRunner,
  Swarm,
  SwarmRunner,
  Parallel,
  ParallelRunner,
} from './concepts';

// ── Tools ───────────────────────────────────────────────────
export { defineTool, askHuman, ToolRegistry } from './tools';

// ── Providers (core — you can't build an agent without these) ─
export { mock, MockAdapter, mockRetriever, MockRetriever, createProvider } from './adapters';
export { anthropic, openai, ollama, bedrock } from './models';
export { AnthropicAdapter, OpenAIAdapter, BedrockAdapter } from './adapters';
export { BrowserAnthropicAdapter, BrowserOpenAIAdapter } from './adapters';
export { InMemoryStore } from './adapters/memory/inMemory';
export { redisStore, dynamoStore, postgresStore } from './adapters/memory/stores';
export type { ModelConfig } from './models';

// ── Provider Interfaces ─────────────────────────────────────
export type {
  PromptProvider,
  PromptContext,
  ToolProvider,
  ToolContext,
  ToolExecutionResult,
  AgentRecorder,
} from './core';
export type { ConversationStore, MemoryConfig } from './adapters/memory/types';
export type {
  RedisLike,
  RedisStoreOptions,
  DynamoLike,
  DynamoStoreOptions,
  PostgresLike,
  PostgresStoreOptions,
} from './adapters/memory/stores';
export type { ResponseFormat, LLMStreamChunk } from './types';

// ── Messages + Content ──────────────────────────────────────
export {
  systemMessage,
  userMessage,
  assistantMessage,
  toolResultMessage,
  textBlock,
  imageBlock,
  base64Image,
  urlImage,
} from './types';

// ── Errors ──────────────────────────────────────────────────
export { LLMError } from './types';

// ── Core Types ──────────────────────────────────────────────
export type {
  Message,
  ToolCall,
  LLMProvider,
  LLMResponse,
  LLMCallOptions,
  TokenUsage,
  LLMToolDescription,
  ToolDefinition,
  ToolHandler,
  ToolResult,
  AgentResult,
  AgentRunOptions,
  RunnerLike,
  RetrieverProvider,
  RetrievalChunk,
  RAGResult,
  LLMErrorCode,
} from './types';

// ── Streaming Event Types (for agent.run({ onEvent })) ──────
export type { AgentStreamEvent, AgentStreamEventHandler } from './streaming';
