// ── Types ────────────────────────────────────────────────────
export type {
  // Content blocks (multi-modal)
  ContentBlock,
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
  ImageSource,
  Base64ImageSource,
  UrlImageSource,
  MessageContent,
  StreamCallback,
  StreamChunk,
  // Messages
  Message,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
  // LLM
  LLMProvider,
  LLMCallOptions,
  LLMResponse,
  LLMStreamChunk,
  TokenUsage,
  LLMToolDescription,
  // Tools
  ToolDefinition,
  ToolHandler,
  ToolResult,
  // Adapters
  AdapterResult,
  AdapterFinalResult,
  AdapterToolResult,
  AdapterErrorResult,
  // Agent
  AgentConfig,
  AgentBuildResult,
  AgentResult,
  AgentRunOptions,
  // Retrieval
  RetrieverProvider,
  RetrieveOptions,
  RetrievalChunk,
  RetrievalResult,
  RAGResult,
  // Multi-agent
  RunnerLike,
  AgentStageConfig,
  AgentResultEntry,
  TraversalResult,
  // Errors
  LLMErrorCode,
} from './types';

export {
  // Content block factories
  textBlock,
  imageBlock,
  base64Image,
  urlImage,
  toolUseBlock,
  toolResultBlock,
  // Content helpers
  toolCallToBlock,
  blockToToolCall,
  getTextContent,
  contentLength,
  hasToolUseBlocks,
  getToolUseBlocks,
  // Message factories
  systemMessage,
  userMessage,
  assistantMessage,
  toolResultMessage,
  hasToolCalls,
  ADAPTER_PATHS,
  // Errors
  LLMError,
  wrapSDKError,
  classifyStatusCode,
} from './types';

// ── Models ───────────────────────────────────────────────────
export type { ModelConfig, ModelOptions, ModelPricing } from './models';
export { anthropic, openai, ollama, bedrock, DEFAULT_PRICING, lookupPricing } from './models';

// ── Adapters ─────────────────────────────────────────────────
export {
  MockAdapter,
  mock,
  MockRetriever,
  mockRetriever,
  createAdapterSubflow,
  AnthropicAdapter,
  OpenAIAdapter,
  BedrockAdapter,
  BrowserAnthropicAdapter,
  BrowserOpenAIAdapter,
  createProvider,
  mcpToolProvider,
  a2aRunner,
} from './adapters';
export type {
  MockResponse,
  MockRetrievalResponse,
  AdapterSubflowConfig,
  AnthropicAdapterOptions,
  OpenAIAdapterOptions,
  BedrockAdapterOptions,
  BrowserAnthropicAdapterOptions,
  BrowserOpenAIAdapterOptions,
  MCPClient,
  MCPToolInfo,
  MCPToolResult,
  MCPToolProviderOptions,
  A2AClient,
  A2AResponse,
  A2ARunnerOptions,
} from './adapters';

// ── Tools ────────────────────────────────────────────────────
export { ToolRegistry, defineTool } from './tools';

// ── Memory ───────────────────────────────────────────────────
export {
  appendMessage,
  lastMessage,
  lastAssistantMessage,
  lastMessageHasToolCalls,
  slidingWindow,
  truncateToCharBudget,
  createToolResults,
} from './memory';

// ── Scope ────────────────────────────────────────────────────
export { AgentScope, AGENT_PATHS, RAG_PATHS, MULTI_AGENT_PATHS } from './scope';
export type { ParsedResponse } from './scope';

// ── Stages ───────────────────────────────────────────────────
export {
  createSeedScopeStage,
  promptAssemblyStage,
  createCallLLMStage,
  parseResponseStage,
  createHandleResponseStage,
  finalizeStage,
  normalizeAdapterResponse,
  executeToolCalls,
  createRetrieveStage,
  augmentPromptStage,
  runnerAsStage,
} from './stages';

// ── Concepts ─────────────────────────────────────────────────
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
} from './concepts';

// ── Recorders (AgentRecorder interface) ─────────────────────
export {
  TokenRecorder,
  CostRecorder,
  TurnRecorder,
  ToolUsageRecorder,
  QualityRecorder,
  GuardrailRecorder,
  CompositeRecorder,
} from './recorders';
export type {
  TokenStats,
  LLMCallEntry,
  CostEntry,
  CostRecorderOptions,
  TurnEntry,
  ToolUsageStats,
  ToolStats,
  QualityScore,
  QualityJudge,
  Violation,
  GuardrailCheck,
} from './recorders';

// ── Providers ────────────────────────────────────────────────
export { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from './providers';
export type { Skill, SkillBasedPromptOptions, CompositePromptOptions } from './providers';
export { agentAsTool, compositeTools } from './providers';
export type { AgentAsToolConfig } from './providers';
export type {
  PromptProvider,
  PromptContext,
  ToolProvider,
  ToolContext,
  ToolExecutionResult,
} from './core';

// ── Executor ─────────────────────────────────────────────────
export { agentLoop } from './executor';
export type { AgentLoopOptions, AgentLoopResult } from './executor';
export type { AgentLoopConfig, AgentRecorder } from './core';

// ── Compositions ─────────────────────────────────────────────
export { withRetry, withFallback, withCircuitBreaker, CircuitBreaker } from './compositions';
export type {
  RetryOptions,
  FallbackOptions,
  CircuitBreakerOptions,
  CircuitState,
} from './compositions';

// ── Streaming ────────────────────────────────────────────────
export { StreamEmitter, SSEFormatter } from './streaming';
export type { StreamEvent, StreamEventHandler } from './streaming';
