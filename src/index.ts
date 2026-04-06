/**
 * agentfootprint — The explainable agent framework.
 *
 * Core: builders, tools, messages, types, errors.
 *
 * Capabilities (import from subpaths):
 *   agentfootprint/providers     → Connect to LLM providers
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
  TokenUsage,
  ToolDefinition,
  ToolResult,
  AgentResult,
  RunnerLike,
  RetrieverProvider,
  RetrievalChunk,
  RAGResult,
  LLMErrorCode,
} from './types';

// ── Streaming Event Types (needed for agent.run({ onEvent })) ──
export type { AgentStreamEvent, AgentStreamEventHandler } from './streaming';
