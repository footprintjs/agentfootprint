/**
 * agentfootprint/observe — observability recorders.
 *
 * Pattern: Observer (GoF) — pluggable, fire-and-forget event listeners
 *          for the agent's typed event stream.
 * Role:    Outer ring (Hexagonal). Attach via `runner.attachScopeRecorder()`;
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
 *     • EmbeddingRecorder    — embedding cost, index-time vs query-time
 *     • PermissionRecorder   — permission decisions + denials
 *     • SkillRecorder        — skill activations
 *     • LoggingRecorder      — structured log lines per event
 *     • StatusRecorder     — chat-bubble first-person status
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
  type ActorArrow,
  type BoundaryAggregate,
  type BoundaryRecorderOptions,
  type BoundaryRangeLabel,
  type DomainContextInjectedEvent,
  type DomainDecisionBranchEvent,
  type DomainEvent,
  type DomainForkBranchEvent,
  type DomainLLMEndEvent,
  type DomainLLMStartEvent,
  type DomainLoopIterationEvent,
  type DomainRunEvent,
  type DomainSubflowEvent,
  type DomainToolStartEvent,
  type DomainToolEndEvent,
  type LeanDomainEvent,
  type TypedEventSource,
} from './recorders/observability/BoundaryRecorder.js';
export {
  buildRunSteps,
  RunStepRecorder,
  runStepRecorder,
  type BuildRunStepsOptions,
  type RunStep,
  type RunStepGraph,
  type RunStepKind,
  type RunStepMeta,
  type RunStepRecorderOptions,
  type RunStepTransition,
} from './recorders/observability/RunStepRecorder.js';
export {
  attachFlowchart,
  buildStepGraph,
  buildStepGraphFromEvents,
  type StepGraph,
  type StepNode,
  type StepEdge,
  type SlotBoundary,
  type ContextInjection,
  type FlowchartOptions,
  type FlowchartHandle,
} from './recorders/observability/FlowchartRecorder.js';

// recordRun — save a run so a viewer can show it later. THE producer for
// `{ snapshot, events, structure }`: the timeline, the state, and the chart,
// which is the shape the UIs consume (lens's `observeRecording`) and the one
// every integration used to assemble by hand, each missing a different piece.
export {
  recordRun,
  type Recording,
  type RecordRunOptions,
  type RunRecorder,
} from './recorders/observability/recordRun.js';

// exportBugReport — a bug report IS the evidence. `describeBugReport` measures
// the run first (selectable units, sizes, the redacted keys by NAME) so a human
// can consent to exactly what leaves; `exportBugReport` bundles the units they
// kept as named files plus a real (stored) zip. `githubBugReporter` — in this
// same door, from the providers barrel — files that bundle.
export {
  describeBugReport,
  exportBugReport,
  type BugReport,
  type BugReportEnvironment,
  type BugReportExcluded,
  type BugReportFields,
  type BugReportFile,
  type BugReportFileSummary,
  type BugReportInput,
  type BugReportManifest,
  type BugReportOversize,
  type BugReportSource,
  type BugReportUnit,
  type DescribeBugReportOptions,
  type ExportBugReportOptions,
  type Transcript,
  type TranscriptStep,
  type TranscriptTurn,
} from './lib/bug-report/index.js';

// What a recording keeps of a vector: `{ dims, norm }`, not the bytes (8.20.0).
// Applied by BoundaryRecorder and recordRun unless `recordEmbeddings: true`;
// exported so consumers that render or post-process recordings can apply or
// recognise the same projection.
export {
  summarizeEmbeddings,
  summarizeVector,
  type EmbeddingSummary,
} from './recorders/observability/embeddingSummary.js';

// Offline replay: freeze a live run model into a UI-free, JSON-lossless Trace
// (redaction applied at the serialize boundary). agentfootprint-lens's <Replay>
// rehydrates it. See docs/design/local-observability-and-pii.md.
export {
  serializeTrace,
  redactContent,
  traceToStepGraph,
  type Trace,
  type TraceSummary,
  type TraceRedaction,
  type SerializeTraceOptions,
} from './recorders/observability/trace.js';

// localObservability — Tier-3 retain: live onLive(graph) + offline
// getTrace()/onRecorded. NOT a Lens recorder — to render a run in Lens, use
// `recordRun` above and lens's `observeRecording`.
export {
  attachLocalObservability,
  type LocalObservabilityHandle,
  type LocalObservabilityOptions,
} from './recorders/observability/localObservability.js';

export {
  liveStateRecorder,
  LiveStateRecorder,
  LiveLLMTracker,
  LiveToolTracker,
  LiveAgentTurnTracker,
  type LLMLiveState,
  type ToolLiveState,
  type AgentTurnLiveState,
  type LiveStateRunnerLike,
} from './recorders/observability/LiveStateRecorder.js';

// Tier 3 — domain dashboards
export { costRecorder, type CostRecorderOptions } from './recorders/core/CostRecorder.js';
export { toolsRecorder, type ToolsRecorderOptions } from './recorders/core/ToolsRecorder.js';
export {
  contextEvaluatedRecorder,
  type ContextEvaluatedRecorderOptions,
} from './recorders/core/ContextEvaluatedRecorder.js';
export { evalRecorder, type EvalRecorderOptions } from './recorders/core/EvalRecorder.js';
export { memoryRecorder, type MemoryRecorderOptions } from './recorders/core/MemoryRecorder.js';
export {
  embeddingRecorder,
  type EmbeddingRecorderOptions,
} from './recorders/core/EmbeddingRecorder.js';
export {
  permissionRecorder,
  type PermissionRecorderOptions,
} from './recorders/core/PermissionRecorder.js';
export { skillRecorder, type SkillRecorderOptions } from './recorders/core/SkillRecorder.js';
// Provider-decorator telemetry (fallback.triggered / error.retried /
// error.recovered / error.circuit_changed). Attached automatically by
// Agent / LLMCall / Parallel;
// exported so consumers running the public message-api charts on a bare
// FlowChartExecutor can wire the bridge themselves.
export {
  resilienceRecorder,
  type ResilienceRecorderOptions,
} from './recorders/core/ResilienceRecorder.js';
export {
  attachLogging,
  LoggingDomains,
  type LoggingLogger,
  type LoggingDomain,
  type LoggingOptions,
} from './recorders/observability/LoggingRecorder.js';
export {
  attachStatus,
  type StatusEvent,
  type StatusOptions,
} from './recorders/observability/StatusRecorder.js';
// Tool→tool DATA-FLOW graph, derived by value provenance from the tool emit
// stream (see finding 2: causalChain can't see LLM-mediated tool dependencies).
export {
  toolLineageRecorder,
  type ToolLineageRecorderHandle,
  type ToolLineageOptions,
  type ToolLineageGraph,
  type ToolLineageEdge,
  type ToolCallRef,
} from './recorders/observability/ToolLineageRecorder.js';
// AgentThinkingUI Trace (run → the "watch it think" beat list, collected during
// traversal). Lets any agentfootprint run drive AgentThinkingUI / domain views.
export {
  agentThinkingTrace,
  type AgentThinkingTraceHandle,
  type AgentThinkingTraceOptions,
  type AttTrace,
  type AttStep,
  type AttCost,
  type AttAnswer,
  type AttToolSeen,
} from './recorders/observability/AgentThinkingTraceRecorder.js';

// Emit primitive — used by every Tier-3 source-domain.
export { typedEmit } from './recorders/core/typedEmit.js';

// ── Diagnosis tools ────────────────────────────────────────────
// influence-core, trace-toolpack, context-bisect and tool-lint live in
// `src/debug.ts`. 8.0.0 folded their import path INTO this one, and 9.0.0
// removed the separate `agentfootprint/debug` subpath, so this re-export is
// how they reach the door. Watching a healthy run and performing the autopsy
// on a broken one come through the same door on purpose.
export * from './debug.js';
// Tool-choice margin recorder (RFC-002 tier 2, C4–C6) — per LLM call,
// ranks the OFFERED catalog against the choice context (user message +
// latest assistant reasoning) via influence-core scoreMargin; embeds
// LAZILY on first read; flags narrow margins + proxy disagreements.
export {
  buildChoiceContext,
  toolChoiceRecorder,
  type OfferedTool,
  type ToolChoiceCall,
  type ToolChoiceRecorderHandle,
  type ToolChoiceRecorderOptions,
  type ToolChoiceSkipReason,
  type ToolChoiceSummary,
} from './recorders/observability/ToolChoiceRecorder.js';

export {
  routeRecorder,
  formatRouteHop,
  type RouteRecorderHandle,
  type RouteRecorderOptions,
  type RouteHop,
  type RouteOutcome,
  type RouteTrip,
  type RouteTripKind,
} from './recorders/observability/RouteRecorder.js';

// context-ledger — which context pieces EARNED their tokens? Post-run
// bookkeeping (offers/uses/outcomes from the commit log) feeding the gating
// seams. See src/lib/context-ledger/README.md.
export {
  contextLedger,
  ledgerToolGate,
  ledgerEntryScorer,
  ledgerGated,
} from './lib/context-ledger/index.js';
export type {
  ContextLedger,
  LedgerJSON,
  LedgerPolicy,
  LedgerRow,
  PieceKind,
  RecordedRun,
  UsedSignal,
} from './lib/context-ledger/index.js';
