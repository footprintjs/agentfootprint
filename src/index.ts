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
  fallbackProvider,
  resilientProvider,
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
  FallbackProviderOptions,
  ResilientProviderOptions,
} from './adapters';

// ── Tools ────────────────────────────────────────────────────
export { ToolRegistry, defineTool, askHuman } from './tools';

// ── Instructions (LLM guidance co-located with tools) ───────
export {
  quickBind,
  processInstructions,
  InstructionRecorder,
  previewInstructions,
  evaluateAgentInstructions,
  buildInstructionsToLLMSubflow,
  defineInstruction,
} from './lib/instructions';
export type {
  LLMInstruction,
  FollowUpBinding,
  InstructionContext,
  RuntimeFollowUp,
  InstructedToolResult,
  InstructedToolDefinition,
  InstructionOverride,
  InstructionTemplate,
  ResolvedInstruction,
  InstructionInjectionResult,
  InstructionSummary,
  InstructionPreview,
  PreviewContext,
  AgentInstruction,
  InstructionEvaluationResult,
} from './lib/instructions';

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

// ── Memory Adapters ──────────────────────────────────────────
export { InMemoryStore } from './adapters/memory/inMemory';
export type { ConversationStore, MemoryConfig } from './adapters/memory/types';

// ── Subflows ─────────────────────────────────────────────────
export { createPrepareMemorySubflow } from './subflows';
export type { PrepareMemoryConfig } from './subflows';

// ── Scope ────────────────────────────────────────────────────
export { AgentScope, AGENT_PATHS, RAG_PATHS, MULTI_AGENT_PATHS, MEMORY_PATHS } from './scope';
export type { ParsedResponse } from './scope';

// ── Stages ───────────────────────────────────────────────────
export {
  createCallLLMStage,
  parseResponseStage,
  createCommitMemoryStage,
  finalizeStage,
  normalizeAdapterResponse,
  executeToolCalls,
  createRetrieveStage,
  augmentPromptStage,
  runnerAsStage,
} from './stages';
export type { CommitMemoryConfig } from './stages';

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
  Parallel,
  ParallelRunner,
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
  PermissionRecorder,
  agentObservability,
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
  PermissionEvent,
  AgentObservabilityOptions,
  AgentObservabilityRecorder,
} from './recorders';

// ── Providers ────────────────────────────────────────────────
export { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from './providers';
export type { Skill, SkillBasedPromptOptions, CompositePromptOptions } from './providers';
export { agentAsTool, compositeTools, gatedTools, PermissionPolicy } from './providers';
export type { AgentAsToolConfig, PermissionChecker, GatedToolsOptions, PermissionPolicyOptions, PermissionChangeEvent } from './providers';
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
export { AgentPattern } from './lib/loop';

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
export type { AgentStreamEvent, AgentStreamEventHandler, StreamEvent, StreamEventHandler } from './streaming';

// ── Narrative ───────────────────────────────────────────────
export { createAgentRenderer, getGroundingSources, getLLMClaims, getFullLLMContext } from './lib/narrative';
export type { AgentRendererOptions, GroundingSource, LLMClaim, LLMContextSnapshot } from './lib/narrative';
export { AgentScopeKey } from './scope/types';

// ── Library-of-Libraries (slot subflow internals) ────────────
export { buildAgentLoop, SUBFLOW_MESSAGE_KEY } from './lib/loop';
export type { AgentLoopSeedOptions } from './lib/loop';
export {
  buildSystemPromptSubflow,
  buildMessagesSubflow,
  buildToolsSubflow,
} from './lib/slots';
export type {
  SystemPromptSlotConfig,
  MessagesSlotConfig,
  ToolsSlotConfig,
} from './lib/slots';
