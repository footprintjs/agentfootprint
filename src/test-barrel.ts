/**
 * Test barrel — re-exports everything for internal tests.
 * NOT a public API. Tests import from here; consumers import from subpaths.
 */

// Core
export * from './index';

// Providers
export * from './providers.barrel';

// Instructions
export * from './instructions.barrel';

// Observe
export * from './observe.barrel';

// Resilience
export * from './resilience.barrel';

// Security — selective (avoid PermissionRecorder duplication with observe)
export { gatedTools, PermissionPolicy } from './providers';
export type { PermissionChecker, GatedToolsOptions, PermissionPolicyOptions, PermissionChangeEvent } from './providers';

// Explain
export * from './explain.barrel';

// Stream
export * from './stream.barrel';

// Internals used by tests
export { AgentScope, AGENT_PATHS, RAG_PATHS, MULTI_AGENT_PATHS, MEMORY_PATHS } from './scope';
export type { ParsedResponse } from './scope';
export { createCallLLMStage, parseResponseStage, createCommitMemoryStage, finalizeStage, normalizeAdapterResponse, executeToolCalls, createRetrieveStage, augmentPromptStage, runnerAsStage } from './stages';
export type { CommitMemoryConfig } from './stages';
export { appendMessage, lastMessage, lastAssistantMessage, lastMessageHasToolCalls, slidingWindow, truncateToCharBudget, createToolResults } from './memory';
export { InMemoryStore } from './adapters/memory/inMemory';
export type { ConversationStore, MemoryConfig } from './adapters/memory/types';
export { agentLoop } from './executor';
export type { AgentLoopOptions, AgentLoopResult } from './executor';
export { AgentPattern } from './lib/loop';
export { buildAgentLoop, SUBFLOW_MESSAGE_KEY } from './lib/loop';
export type { AgentLoopSeedOptions, AgentLoopConfig as AgentLoopConfigType } from './lib/loop';
export { createPrepareMemorySubflow } from './subflows';
export { buildSystemPromptSubflow, buildMessagesSubflow, buildToolsSubflow } from './lib/slots';
export { createAdapterSubflow } from './adapters';
export { ADAPTER_PATHS, hasToolCalls, wrapSDKError, classifyStatusCode } from './types';
export { toolUseBlock, toolResultBlock, toolCallToBlock, blockToToolCall, getTextContent, contentLength, hasToolUseBlocks, getToolUseBlocks } from './types';
// Additional types from various sources
export type {
  ContentBlock, TextBlock, ImageBlock, ToolUseBlock, ToolResultBlock,
  ImageSource, Base64ImageSource, UrlImageSource, MessageContent, StreamCallback, StreamChunk,
  SystemMessage, UserMessage, AssistantMessage, ToolResultMessage,
  LLMCallOptions, LLMStreamChunk, LLMToolDescription,
  ToolHandler,
  AdapterResult, AdapterFinalResult, AdapterToolResult, AdapterErrorResult,
  AgentConfig, AgentBuildResult, AgentRunOptions,
  RetrieveOptions, RetrievalResult,
  AgentStageConfig, AgentResultEntry, TraversalResult,
} from './types';
export type { ModelConfig, ModelOptions, ModelPricing } from './models';
export type {
  MockResponse, MockRetrievalResponse, AdapterSubflowConfig,
  AnthropicAdapterOptions, OpenAIAdapterOptions, BedrockAdapterOptions,
  BrowserAnthropicAdapterOptions, BrowserOpenAIAdapterOptions,
  MCPClient, MCPToolInfo, MCPToolResult, MCPToolProviderOptions,
  A2AClient, A2AResponse, A2ARunnerOptions,
  FallbackProviderOptions, ResilientProviderOptions,
} from './adapters';
export type { Skill, SkillBasedPromptOptions, CompositePromptOptions, AgentAsToolConfig } from './providers';
export type { AgentLoopConfig, AgentRecorder, PromptProvider, PromptContext, ToolProvider, ToolContext, ToolExecutionResult } from './core';
export type {
  LLMInstruction, FollowUpBinding, InstructionContext, RuntimeFollowUp,
  InstructedToolResult, InstructedToolDefinition, InstructionOverride,
  InstructionTemplate, ResolvedInstruction, InstructionInjectionResult,
  InstructionSummary, InstructionPreview, PreviewContext,
  AgentInstruction, InstructionEvaluationResult,
} from './lib/instructions';
export type { RetryOptions, FallbackOptions, CircuitBreakerOptions, CircuitState } from './compositions';
export type {
  TokenStats, LLMCallEntry, CostEntry, CostRecorderOptions,
  TurnEntry, ToolUsageStats, ToolStats, QualityScore, QualityJudge,
  Violation, GuardrailCheck, PermissionEvent,
  AgentObservabilityOptions, AgentObservabilityRecorder,
} from './recorders';
export type { PrepareMemoryConfig } from './subflows';
export type { SystemPromptSlotConfig, MessagesSlotConfig, ToolsSlotConfig } from './lib/slots';

// Re-exports that might have name conflicts — explicit
export { processInstructions, evaluateAgentInstructions, buildInstructionsToLLMSubflow, previewInstructions, quickBind } from './lib/instructions';
export { InstructionRecorder } from './lib/instructions';
export { DEFAULT_PRICING, lookupPricing } from './models';
export { AgentScopeKey } from './scope/types';
