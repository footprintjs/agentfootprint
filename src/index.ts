/**
 * agentfootprint — The explainable agent framework.
 *
 * For cleaner imports, use capability subpaths:
 *
 *   agentfootprint/providers     → Connect to LLM providers
 *   agentfootprint/instructions  → Conditional context injection
 *   agentfootprint/observe       → Monitor execution (recorders)
 *   agentfootprint/resilience    → Retry, fallback, circuit breaker
 *   agentfootprint/security      → Tool gating, permissions
 *   agentfootprint/explain       → Narrative, grounding analysis
 *   agentfootprint/stream        → Real-time lifecycle events
 */

// ── Core: Concepts ──────────────────────────────────────────
export {
  Agent, AgentRunner,
  LLMCall, LLMCallRunner,
  RAG, RAGRunner,
  FlowChart, FlowChartRunner,
  Swarm, SwarmRunner,
  Parallel, ParallelRunner,
} from './concepts';

// ── Core: Tools ─────────────────────────────────────────────
export { ToolRegistry, defineTool, askHuman } from './tools';

// ── Core: Messages + Content ────────────────────────────────
export {
  textBlock, imageBlock, base64Image, urlImage, toolUseBlock, toolResultBlock,
  toolCallToBlock, blockToToolCall, getTextContent, contentLength, hasToolUseBlocks, getToolUseBlocks,
  systemMessage, userMessage, assistantMessage, toolResultMessage, hasToolCalls,
  LLMError, wrapSDKError, classifyStatusCode,
  ADAPTER_PATHS,
} from './types';
export type {
  ContentBlock, TextBlock, ImageBlock, ToolUseBlock, ToolResultBlock,
  ImageSource, Base64ImageSource, UrlImageSource, MessageContent, StreamCallback, StreamChunk,
  Message, SystemMessage, UserMessage, AssistantMessage, ToolResultMessage, ToolCall,
  LLMProvider, LLMCallOptions, LLMResponse, LLMStreamChunk, TokenUsage, LLMToolDescription,
  ToolDefinition, ToolHandler, ToolResult,
  AdapterResult, AdapterFinalResult, AdapterToolResult, AdapterErrorResult,
  AgentConfig, AgentBuildResult, AgentResult, AgentRunOptions,
  RetrieverProvider, RetrieveOptions, RetrievalChunk, RetrievalResult, RAGResult,
  RunnerLike, AgentStageConfig, AgentResultEntry, TraversalResult,
  LLMErrorCode,
} from './types';

// ── Providers (also available from agentfootprint/providers) ─
export type { ModelConfig, ModelOptions, ModelPricing } from './models';
export { anthropic, openai, ollama, bedrock, DEFAULT_PRICING, lookupPricing } from './models';
export {
  MockAdapter, mock, MockRetriever, mockRetriever, createAdapterSubflow,
  AnthropicAdapter, OpenAIAdapter, BedrockAdapter,
  BrowserAnthropicAdapter, BrowserOpenAIAdapter,
  createProvider, fallbackProvider, resilientProvider, mcpToolProvider, a2aRunner,
} from './adapters';
export type {
  MockResponse, MockRetrievalResponse, AdapterSubflowConfig,
  AnthropicAdapterOptions, OpenAIAdapterOptions, BedrockAdapterOptions,
  BrowserAnthropicAdapterOptions, BrowserOpenAIAdapterOptions,
  MCPClient, MCPToolInfo, MCPToolResult, MCPToolProviderOptions,
  A2AClient, A2AResponse, A2ARunnerOptions,
  FallbackProviderOptions, ResilientProviderOptions,
} from './adapters';
export { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from './providers';
export type { Skill, SkillBasedPromptOptions, CompositePromptOptions } from './providers';
export { agentAsTool, compositeTools, gatedTools, PermissionPolicy } from './providers';
export type { AgentAsToolConfig, PermissionChecker, GatedToolsOptions, PermissionPolicyOptions, PermissionChangeEvent } from './providers';
export type { PromptProvider, PromptContext, ToolProvider, ToolContext, ToolExecutionResult, AgentLoopConfig, AgentRecorder } from './core';

// ── Instructions (also available from agentfootprint/instructions) ─
export {
  quickBind, processInstructions, InstructionRecorder, previewInstructions,
  evaluateAgentInstructions, buildInstructionsToLLMSubflow, defineInstruction,
} from './lib/instructions';
export type {
  LLMInstruction, FollowUpBinding, InstructionContext, RuntimeFollowUp,
  InstructedToolResult, InstructedToolDefinition, InstructionOverride,
  InstructionTemplate, ResolvedInstruction, InstructionInjectionResult,
  InstructionSummary, InstructionPreview, PreviewContext,
  AgentInstruction, InstructionEvaluationResult,
} from './lib/instructions';

// ── Observe (also available from agentfootprint/observe) ────
export {
  TokenRecorder, CostRecorder, TurnRecorder, ToolUsageRecorder,
  QualityRecorder, GuardrailRecorder, CompositeRecorder, PermissionRecorder,
  agentObservability,
} from './recorders';
export type {
  TokenStats, LLMCallEntry, CostEntry, CostRecorderOptions,
  TurnEntry, ToolUsageStats, ToolStats, QualityScore, QualityJudge,
  Violation, GuardrailCheck, PermissionEvent,
  AgentObservabilityOptions, AgentObservabilityRecorder,
} from './recorders';

// ── Resilience (also available from agentfootprint/resilience) ─
export { withRetry, withFallback, withCircuitBreaker, CircuitBreaker } from './compositions';
export type { RetryOptions, FallbackOptions, CircuitBreakerOptions, CircuitState } from './compositions';

// ── Streaming (also available from agentfootprint/stream) ───
export { StreamEmitter, SSEFormatter } from './streaming';
export type { AgentStreamEvent, AgentStreamEventHandler, StreamEvent, StreamEventHandler } from './streaming';

// ── Explain (also available from agentfootprint/explain) ────
export { createAgentRenderer, getGroundingSources, getLLMClaims, getFullLLMContext } from './lib/narrative';
export type { AgentRendererOptions, GroundingSource, LLMClaim, LLMContextSnapshot } from './lib/narrative';
export { AgentScopeKey } from './scope/types';

// ── Memory ──────────────────────────────────────────────────
export { appendMessage, lastMessage, lastAssistantMessage, lastMessageHasToolCalls, slidingWindow, truncateToCharBudget, createToolResults } from './memory';
export { InMemoryStore } from './adapters/memory/inMemory';
export type { ConversationStore, MemoryConfig } from './adapters/memory/types';

// ── Scope ───────────────────────────────────────────────────
export { AgentScope, AGENT_PATHS, RAG_PATHS, MULTI_AGENT_PATHS, MEMORY_PATHS } from './scope';
export type { ParsedResponse } from './scope';

// ── Stages ──────────────────────────────────────────────────
export { createCallLLMStage, parseResponseStage, createCommitMemoryStage, finalizeStage, normalizeAdapterResponse, executeToolCalls, createRetrieveStage, augmentPromptStage, runnerAsStage } from './stages';
export type { CommitMemoryConfig } from './stages';

// ── Executor ────────────────────────────────────────────────
export { agentLoop } from './executor';
export type { AgentLoopOptions, AgentLoopResult } from './executor';
export { AgentPattern } from './lib/loop';

// ── Subflows ────────────────────────────────────────────────
export { createPrepareMemorySubflow } from './subflows';
export type { PrepareMemoryConfig } from './subflows';

// ── Library internals ───────────────────────────────────────
export { buildAgentLoop, SUBFLOW_MESSAGE_KEY } from './lib/loop';
export type { AgentLoopSeedOptions } from './lib/loop';
export { buildSystemPromptSubflow, buildMessagesSubflow, buildToolsSubflow } from './lib/slots';
export type { SystemPromptSlotConfig, MessagesSlotConfig, ToolsSlotConfig } from './lib/slots';
