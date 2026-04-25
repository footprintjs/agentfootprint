/**
 * v2 barrel — public surface for Phase 1 (types + dispatcher + conventions).
 *
 * Pattern: Facade (GoF) over the v2 sublayers.
 * Role:    Single entry point consumers import from during v2 development.
 * Emits:   N/A.
 */

// Events — registry, types, payloads
export * from './events/types.js';
export * from './events/payloads.js';
export {
  EVENT_NAMES,
  ALL_EVENT_TYPES,
  type AgentfootprintEvent,
  type AgentfootprintEventMap,
  type AgentfootprintEventType,
} from './events/registry.js';

// Dispatcher
export {
  EventDispatcher,
  type EventListener,
  type WildcardListener,
  type ListenOptions,
  type Unsubscribe,
  type DomainWildcard,
  type AllWildcard,
  type WildcardSubscription,
} from './events/dispatcher.js';

// Conventions
export {
  SUBFLOW_IDS,
  STAGE_IDS,
  type SubflowId,
  type StageId,
  isSlotSubflow,
  slotFromSubflowId,
  isKnownSubflow,
  isKnownStage,
} from './conventions.js';

// Adapter interfaces (ports)
export * from './adapters/types.js';

// Injection keys + recorder types (convention layer for Phase 2)
export {
  INJECTION_KEYS,
  injectionKeyForSlot,
  isInjectionKey,
  type InjectionKey,
} from './conventions.js';
export {
  COMPOSITION_KEYS,
  type BudgetPressureRecord,
  type CompositionKey,
  type EvictionRecord,
  type InjectionRecord,
  type SlotComposition,
} from './recorders/core/types.js';

// Bridge helper
export { buildEventMeta, parseSubflowPath, type RunContext } from './bridge/eventMeta.js';

// Core recorders
export { ContextRecorder, type ContextRecorderOptions } from './recorders/core/ContextRecorder.js';
export { EmitBridge, type EmitBridgeOptions } from './recorders/core/EmitBridge.js';
export { streamRecorder, type StreamRecorderOptions } from './recorders/core/StreamRecorder.js';
export { agentRecorder, type AgentRecorderOptions } from './recorders/core/AgentRecorder.js';
export {
  compositionRecorder,
  type CompositionRecorderOptions,
} from './recorders/core/CompositionRecorder.js';
export { costRecorder, type CostRecorderOptions } from './recorders/core/CostRecorder.js';
export {
  permissionRecorder,
  type PermissionRecorderOptions,
} from './recorders/core/PermissionRecorder.js';
export { evalRecorder, type EvalRecorderOptions } from './recorders/core/EvalRecorder.js';
export { memoryRecorder, type MemoryRecorderOptions } from './recorders/core/MemoryRecorder.js';
export { skillRecorder, type SkillRecorderOptions } from './recorders/core/SkillRecorder.js';
export { typedEmit } from './recorders/core/typedEmit.js';

// Runner interface + base
export type { EmittedEvent, EnableNamespace, Runner } from './core/runner.js';
export { RunnerBase, makeRunId } from './core/RunnerBase.js';

// Pause/Resume primitives
export {
  pauseHere,
  isPauseRequest,
  isPaused,
  PauseRequest,
  type RunnerPauseOutcome,
} from './core/pause.js';

// Tier 3 observability (enable.* namespace)
export {
  attachThinking,
  type ThinkingEvent,
  type ThinkingOptions,
} from './recorders/observability/ThinkingRecorder.js';
export {
  attachLogging,
  LoggingDomains,
  type LoggingDomain,
  type LoggingLogger,
  type LoggingOptions,
} from './recorders/observability/LoggingRecorder.js';
export {
  attachFlowchart,
  type ContextInjection,
  type FlowchartHandle,
  type FlowchartOptions,
  type StepEdge,
  type StepGraph,
  type StepNode,
} from './recorders/observability/FlowchartRecorder.js';

// Primitives (core/)
export {
  LLMCall,
  LLMCallBuilder,
  type LLMCallInput,
  type LLMCallOptions,
  type LLMCallOutput,
} from './core/LLMCall.js';
export {
  Agent,
  AgentBuilder,
  type AgentInput,
  type AgentOptions,
  type AgentOutput,
} from './core/Agent.js';
export type {
  Tool,
  ToolExecutionContext,
  ToolRegistryEntry,
} from './core/tools.js';

// Slot subflow builders
export {
  buildSystemPromptSlot,
  type SystemPromptFn,
  type SystemPromptSlotConfig,
} from './core/slots/buildSystemPromptSlot.js';
export {
  buildMessagesSlot,
  type InputMessage,
  type MessagesSlotConfig,
} from './core/slots/buildMessagesSlot.js';
export {
  buildToolsSlot,
  type ToolsSlotConfig,
} from './core/slots/buildToolsSlot.js';

// Compositions (core-flow/)
export {
  Sequence,
  SequenceBuilder,
  type SequenceInput,
  type SequenceOptions,
  type SequenceOutput,
} from './core-flow/Sequence.js';
export {
  Parallel,
  ParallelBuilder,
  type BranchOutcome,
  type MergeFn,
  type MergeOutcomesFn,
  type MergeWithLLMOptions,
  type ParallelInput,
  type ParallelOptions,
  type ParallelOutput,
} from './core-flow/Parallel.js';
export {
  Conditional,
  ConditionalBuilder,
  type ConditionalInput,
  type ConditionalOptions,
  type ConditionalOutput,
  type Predicate,
} from './core-flow/Conditional.js';
export {
  Loop,
  LoopBuilder,
  type LoopInput,
  type LoopOptions,
  type LoopOutput,
  type UntilGuard,
} from './core-flow/Loop.js';

// Adapters — LLM providers
export { MockProvider, type MockProviderOptions } from './adapters/llm/MockProvider.js';

// Patterns — factory functions composing primitives + core-flow into
// well-known agent patterns from the research literature.
export * from './patterns/index.js';

// Memory subsystem — narrative beats, fact extraction, embedding-based
// retrieval, and pipelines that compose them. Top-level barrel exports
// the most-used factories; the full subsystem (including types that
// would collide with adapter types like MemoryStore) is reachable via
// the `agentfootprint/memory` subpath import.
export {
  // Pipelines
  defaultPipeline,
  ephemeralPipeline,
  factPipeline,
  narrativePipeline,
  semanticPipeline,
  autoPipeline,
} from './memory/pipeline/index.js';
export {
  // Beat extractors
  heuristicExtractor,
  llmExtractor,
} from './memory/beats/index.js';
export {
  // Fact extractors
  patternFactExtractor,
  llmFactExtractor,
} from './memory/facts/index.js';
