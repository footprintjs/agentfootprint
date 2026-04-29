/**
 * agentfootprint — public barrel.
 *
 * Pattern: Facade (GoF) over the typed sublayers.
 * Role:    Single entry point consumers import from.
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

// Adapter interfaces (ports)
export * from './adapters/types.js';

// Injection keys + recorder authoring helpers — needed by anyone writing
// a custom recorder that switches on injection events.
export {
  INJECTION_KEYS,
  injectionKeyForSlot,
  isInjectionKey,
  type InjectionKey,
} from './conventions.js';
// `STAGE_IDS`, `SUBFLOW_IDS`, `isSlotSubflow`, `slotFromSubflowId`,
// `isKnownStage`, `isKnownSubflow` are intentionally NOT exported — they
// are the internal builder↔recorder coordination protocol, not consumer
// API. Library code reaches them via the relative `./conventions.js`
// import; downstream code should never need them.
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

// Pause/Resume primitives — consumer API for human-in-the-loop tools.
// `PauseRequest` (the throwable signal class) stays internal; consumers
// detect pauses via `isPauseRequest(err)` / `isPaused(outcome)`.
// `askHuman` is the HITL-named alias for `pauseHere` — same behavior,
// reads more naturally inside a tool that's asking a person to decide.
export {
  pauseHere,
  askHuman,
  isPauseRequest,
  isPaused,
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
export {
  BoundaryRecorder,
  boundaryRecorder,
  type ActorArrow,
  type BoundaryRecorderOptions,
  type DomainContextInjectedEvent,
  type DomainDecisionBranchEvent,
  type DomainEvent,
  type DomainForkBranchEvent,
  type DomainLLMEndEvent,
  type DomainLLMStartEvent,
  type DomainLoopIterationEvent,
  type DomainRunEvent,
  type DomainSubflowEvent,
  type DomainToolEndEvent,
  type DomainToolStartEvent,
} from './recorders/observability/BoundaryRecorder.js';

// Commentary — bundled prose templates + engine for narrating a run.
// Consumers ship their own JSON locale / brand voice via the same
// shape; viewers (Lens, CLI tail, log file) consume this surface.
export {
  defaultCommentaryTemplates,
  selectCommentaryKey,
  extractCommentaryVars,
  renderCommentary,
  type CommentaryContext,
  type CommentaryTemplates,
} from './recorders/observability/commentary/commentaryTemplates.js';

// Thinking — chat-bubble surface (separate audience: the end user
// chatting). State machine: idle / streaming / tool / paused. Same
// contract shape as commentary (`Record<string, string>` with
// `{{vars}}`, partial overrides supported, missing keys ignored)
// but a different vocabulary — first-person status, mid-call only.
// Per-tool keys (`tool.<toolName>`) win over the generic `tool` key.
export {
  defaultThinkingTemplates,
  selectThinkingState,
  renderThinkingLine,
  type ThinkingContext,
  type ThinkingState,
  type ThinkingStateKind,
  type ThinkingTemplates,
} from './recorders/observability/thinking/thinkingTemplates.js';

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
  DefineToolOptions,
} from './core/tools.js';
export { defineTool } from './core/tools.js';

// Slot subflow builders are intentionally NOT exported. They are
// internal helpers used only by `Agent.buildChart()` and
// `LLMCall.buildChart()` to construct each primitive's three-slot
// context-engineering subflow tree. Consumers compose at the
// primitive / composition level (Agent / LLMCall / Sequence / …) — they
// never construct slot subflows directly. Power-users authoring a
// custom Agent-like primitive should copy the pattern from
// `src/core/Agent.ts` rather than depend on a private helper surface.

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
// `mock(...)` is the lowercase factory equivalent to `new MockProvider(...)`.
// `anthropic(...)` is the real Claude provider via `@anthropic-ai/sdk`.
export {
  MockProvider,
  mock,
  type MockProviderOptions,
  type MockReply,
} from './adapters/llm/MockProvider.js';
export {
  anthropic,
  AnthropicProvider,
  type AnthropicProviderOptions,
} from './adapters/llm/AnthropicProvider.js';
export {
  openai,
  OpenAIProvider,
  ollama,
  type OpenAIProviderOptions,
} from './adapters/llm/OpenAIProvider.js';
export {
  bedrock,
  BedrockProvider,
  type BedrockProviderOptions,
} from './adapters/llm/BedrockProvider.js';
export {
  browserAnthropic,
  BrowserAnthropicProvider,
  type BrowserAnthropicProviderOptions,
} from './adapters/llm/BrowserAnthropicProvider.js';
export {
  browserOpenai,
  BrowserOpenAIProvider,
  type BrowserOpenAIProviderOptions,
} from './adapters/llm/BrowserOpenAIProvider.js';
export {
  createProvider,
  type ProviderKind,
  type CreateProviderOptions,
} from './adapters/llm/createProvider.js';

// Streaming helpers — agent events → SSE for browser delivery.
export { toSSE, SSEFormatter, encodeSSE, type ToSSEOptions } from './stream.js';

// Injection Engine — the unifying primitive of context engineering.
// One Injection type, four sugar factories, one engine subflow.
export {
  // Primitive types
  type Injection,
  type InjectionTrigger,
  type InjectionContent,
  type InjectionContext,
  type InjectionEvaluation,
  // Engine
  evaluateInjections,
  buildInjectionEngineSubflow,
  type InjectionEngineConfig,
  // Sugar factories — one per injection flavor
  defineInstruction,
  type DefineInstructionOptions,
  defineSkill,
  resolveSurfaceMode,
  SkillRegistry,
  type DefineSkillOptions,
  type SurfaceMode,
  type RefreshPolicy,
  defineSteering,
  type DefineSteeringOptions,
  defineFact,
  type DefineFactOptions,
} from './lib/injection-engine/index.js';

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
export {
  // Layered memory API — consumer-facing factory + const-objects
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  SNAPSHOT_PROJECTIONS,
  type MemoryType,
  type MemoryStrategyKind,
  type MemoryTiming,
  type SnapshotProjection,
  type Strategy,
  type MemoryDefinition,
  type DefineMemoryOptions,
  // Reference implementations + helpers consumers reach for daily.
  // Real-backend adapters (Redis, Postgres, Pinecone, ...) ship as
  // separate subpath exports.
  InMemoryStore,
  mockEmbedder,
  identityNamespace,
  type MemoryIdentity,
  type Embedder,
} from './memory/index.js';

// RAG — retrieval-augmented generation as a context-engineering flavor.
// Thin sugar over `defineMemory({ type: SEMANTIC, strategy: TOP_K })`
// plus the `indexDocuments` helper for seeding the corpus at startup.
export {
  defineRAG,
  type DefineRAGOptions,
  indexDocuments,
  type IndexDocumentsOptions,
  type RagDocument,
} from './lib/rag/index.js';

// MCP — Model Context Protocol client. Connect to MCP servers and
// expose their tools as agentfootprint Tool[] for `agent.tools(...)`.
// `@modelcontextprotocol/sdk` is a lazy-required peer-dep (no runtime
// cost when MCP isn't used).
export {
  mcpClient,
  mockMcpClient,
  type McpClient,
  type McpClientOptions,
  type McpHttpTransport,
  type McpStdioTransport,
  type McpTransport,
  type McpSdkClient,
  type MockMcpClientOptions,
  type MockMcpTool,
} from './lib/mcp/index.js';

// Tool dispatch primitives (v2.5+). New `agentfootprint/tool-providers`
// subpath bundles tool sources (mcpClient / mockMcpClient) with tool
// dispatch primitives (staticTools / gatedTools) so consumers find
// "everything tool-related" in one place. Top-level barrel re-exports
// the dispatch primitives too — `mcpClient` already re-exports above.
export {
  staticTools,
  gatedTools,
  type ToolProvider,
  type ToolDispatchContext,
  type ToolGatePredicate,
} from './tool-providers/index.js';
