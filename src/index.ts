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
  Conditional,
  ConditionalRunner,
} from './concepts';
export type {
  CustomRouteBranch,
  CustomRouteConfig,
  ConditionalOptions,
  ConditionalPredicate,
} from './concepts';

// ── Trace export (paste-into-viewer / share-with-support workflow) ─
export { exportTrace } from './exportTrace';
export type { AgentfootprintTrace, ExportTraceOptions } from './exportTrace';

// ── Tools ───────────────────────────────────────────────────
export { defineTool, askHuman, ToolRegistry } from './tools';

// ── Providers (core — you can't build an agent without these) ─
export { mock, MockAdapter, mockRetriever, MockRetriever, createProvider } from './adapters';
export { anthropic, openai, ollama, bedrock } from './models';
export { AnthropicAdapter, OpenAIAdapter, BedrockAdapter } from './adapters';
export { BrowserAnthropicAdapter, BrowserOpenAIAdapter } from './adapters';
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
  ToolDefinitionInput,
  ToolHandler,
  ToolResult,
  ZodSchemaLike,
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

// ── Agent Loop (low-level engine) ──────────────────────────
export { agentLoop } from './executor';
export type { AgentLoopConfig } from './core/config';

// ── Instructions (also available from agentfootprint/instructions) ──
export { defineInstruction, AgentPattern, quickBind } from './instructions.barrel';
export type { AgentInstruction, InstructedToolDefinition } from './instructions.barrel';

// ── Skills (also available from agentfootprint/skills) ──
export { defineSkill, SkillRegistry } from './skills.barrel';
export type { Skill, SurfaceMode, SkillRegistryOptions, SkillListEntry } from './skills.barrel';

// ── Recorders (also available from agentfootprint/observe) ──
export { TokenRecorder, ToolUsageRecorder, TurnRecorder, CostRecorder } from './observe.barrel';
