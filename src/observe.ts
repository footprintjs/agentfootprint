/**
 * agentfootprint/observe — observability recorders.
 *
 * Pattern: Observer (GoF) — pluggable, fire-and-forget event listeners
 *          for the agent's typed event stream.
 * Role:    Outer ring (Hexagonal). Attach via `runner.attachRecorder()`;
 *          the runner emits events, recorders accumulate state.
 *
 * Three tiers (progressive disclosure):
 *
 *   Tier 1 — context + stream                                (the core)
 *     • ContextRecorder      — every slot composition
 *     • StreamRecorder       — token-level LLM streaming
 *
 *   Tier 2 — composition + agent                       (structural nav)
 *     • CompositionRecorder  — Sequence/Parallel/Conditional/Loop entries
 *     • AgentRecorder        — agent-loop iterations, tool calls
 *     • BoundaryRecorder     — domain-tagged subflow entry/exit
 *     • FlowchartRecorder    — StepGraph projection (Lens-friendly)
 *
 *   Tier 3 — domain dashboards                              (attach on demand)
 *     • CostRecorder         — token/USD spend
 *     • EvalRecorder         — eval scores from `runner.emit('eval.*', ...)`
 *     • MemoryRecorder       — memory injections + writes
 *     • PermissionRecorder   — permission decisions + denials
 *     • SkillRecorder        — skill activations
 *     • LoggingRecorder      — structured log lines per event
 *     • ThinkingRecorder     — chat-bubble first-person status
 *
 * Domain-flavored consumers (Lens, Grafana, Datadog) compose Tier 1+2
 * directly; Tier 3 dashboards are opt-in.
 */

// Tier 1 — context + stream
export { ContextRecorder, type ContextRecorderOptions } from './recorders/core/ContextRecorder.js';
export { streamRecorder, type StreamRecorderOptions } from './recorders/core/StreamRecorder.js';

// Tier 2 — composition + agent
export {
  compositionRecorder,
  type CompositionRecorderOptions,
} from './recorders/core/CompositionRecorder.js';
export { agentRecorder, type AgentRecorderOptions } from './recorders/core/AgentRecorder.js';
export {
  boundaryRecorder,
  BoundaryRecorder,
  type DomainEvent,
  type DomainLLMEndEvent,
  type DomainLLMStartEvent,
  type DomainToolStartEvent,
  type DomainToolEndEvent,
  type DomainSubflowEvent,
  type DomainLoopIterationEvent,
} from './recorders/observability/BoundaryRecorder.js';
export {
  attachFlowchart,
  buildStepGraph,
  type StepGraph,
  type StepNode,
  type StepEdge,
  type SlotBoundary,
  type ContextInjection,
  type FlowchartOptions,
  type FlowchartHandle,
} from './recorders/observability/FlowchartRecorder.js';

// Tier 3 — domain dashboards
export { costRecorder, type CostRecorderOptions } from './recorders/core/CostRecorder.js';
export { evalRecorder, type EvalRecorderOptions } from './recorders/core/EvalRecorder.js';
export { memoryRecorder, type MemoryRecorderOptions } from './recorders/core/MemoryRecorder.js';
export {
  permissionRecorder,
  type PermissionRecorderOptions,
} from './recorders/core/PermissionRecorder.js';
export { skillRecorder, type SkillRecorderOptions } from './recorders/core/SkillRecorder.js';
export {
  attachLogging,
  LoggingDomains,
  type LoggingLogger,
  type LoggingDomain,
  type LoggingOptions,
} from './recorders/observability/LoggingRecorder.js';
export {
  attachThinking,
  type ThinkingEvent,
  type ThinkingOptions,
} from './recorders/observability/ThinkingRecorder.js';

// Emit primitive — used by every Tier-3 source-domain.
export { typedEmit } from './recorders/core/typedEmit.js';
