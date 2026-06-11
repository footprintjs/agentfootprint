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
  type StepGraph,
  type StepNode,
  type StepEdge,
  type SlotBoundary,
  type ContextInjection,
  type FlowchartOptions,
  type FlowchartHandle,
} from './recorders/observability/FlowchartRecorder.js';
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

// influence-core — the ONE embedding-based scoring engine (RFC-002/003
// block D6). Not a recorder: pure, embedder-injected scoring functions
// + the shared bounded embedding cache. Future /observe features build
// on it (RFC-002 C1 catalog lint, C4/C5 margin recorder, RFC-003 D7
// edge weigher). Honest claim: every score is an embedding-geometry
// PROXY — semantic alignment, never model internals, never causal
// attribution.
export {
  adaptWeights,
  averageRelevancy,
  compositeScore,
  contentHash,
  DEFAULT_INFLUENCE_WEIGHTS,
  DEFAULT_MARGIN_THRESHOLD,
  DEFAULT_PERSISTENCE_THRESHOLD,
  EmbeddingCache,
  embeddingCache,
  finalAnswerSimilarity,
  pairwiseSimilarity,
  persistence,
  scoreInfluence,
  scoreMargin,
  structuralProximity,
  type CandidateScore,
  type Embedder,
  type EmbeddingCacheOptions,
  type EmbeddingCacheStats,
  type EvidenceInput,
  type InfluenceScore,
  type InfluenceWeights,
  type MarginCandidate,
  type MarginResult,
  type PairwiseSimilarityArgs,
  type PairwiseSimilarityResult,
  type ScoreInfluenceArgs,
  type ScoreMarginArgs,
  type SignalScores,
  type SimilarityItem,
  type SimilarityPair,
} from './lib/influence-core/index.js';
// Introspection toolpack (RFC-003 Part C) — footprintjs trace evidence
// exposed as TOOLS a debugging LLM calls over a COMPLETED run's artifacts.
// Bounded, honest (⚠ markers), redaction-respecting, id-navigable.
export {
  callTraceTool,
  lazyTraceToolpack,
  NO_COMPLETED_RUN_MESSAGE,
  TOOLPACK_HARD_CAPS,
  traceToolpack,
  type TraceToolpackArtifacts,
  type TraceToolpackOptions,
} from './lib/trace-toolpack/index.js';
// The two conversational doors over the toolpack: a DEDICATED debugger
// agent (separate session, any provider — cheap models welcome), and the
// in-conversation `.selfExplain()` builder option's types. Same evidence,
// same honesty discipline as the UI doors (BacktrackView / Lens).
export {
  buildSelfExplainSkill,
  buildSelfExplainToolProvider,
  SelfExplainBinding,
  traceDebugAgent,
  type SelfExplainOptions,
  type TraceDebugAgentOptions,
} from './lib/trace-toolpack/index.js';
// Contextual-bug localizer (RFC-003 Part B, D7–D9) — "git bisect for
// context". Assembly: footprintjs causal DAG (control edges + honesty
// markers + EdgeWeigher) × influence-core scoring (D6) × consumer-run
// counterfactual ablation. §B2 claim tiers: scores/weights are
// embedding-geometry PROXIES; ablation verdicts are the ONLY causal
// claims; slice completeness is bounded by tracking — and says so.
export {
  ablationForSuspect,
  applyAblations,
  bisectCulprits,
  CONTEXT_BISECT_DEFAULTS,
  defaultOutcomeComparator,
  defaultSuspectClassifier,
  formatContextBugReport,
  llmCallIdsFromEvents,
  llmEdgeWeigher,
  localizeContextBug,
  probeFlipped,
  runAblationProbe,
  stepOutputText,
  suspectLabel,
  verdictFor,
  type AblationRerun,
  type AblationRunner,
  type AblationRunStats,
  type AblationSpec,
  type AblationTargets,
  type AblationVerdict,
  type AblationVerdictKind,
  type BisectCulpritsOptions,
  type BisectionProbe,
  type BisectionResult,
  type CapturedEventLike,
  type ClassifyContext,
  type ContextBugArtifacts,
  type ContextBugReport,
  type EdgePathStep,
  type HonestyFlag,
  type HonestyFlagKind,
  type LlmEdgeWeigherHandle,
  type LlmEdgeWeigherOptions,
  type LocalizeContextBugOptions,
  type OutcomeComparator,
  type QualityTriggerLookup,
  type RankedParentEdge,
  type SimilarityStats,
  type SliceStats,
  type Suspect,
  type SuspectClassifier,
  type SuspectDetail,
  type SuspectKind,
  type SuspectSeed,
} from './lib/context-bisect/index.js';
// BacktrackTrace serializer — feeds agentThinkingUI's <BacktrackView>
// (the "why?" board) straight off a localizer report. Pure mapping, no
// UI dependency; the interfaces mirror agentthinkingui's contract.
export {
  toBacktrackTrace,
  type BacktrackCustodyHop,
  type BacktrackHop,
  type BacktrackSuspectCard,
  type BacktrackTrace,
  type BacktrackTrail,
  type ToBacktrackTraceOptions,
} from './lib/context-bisect/index.js';
// Tool-catalog confusability lint (RFC-002 tier 1, C1–C3) — build-time,
// CI-gateable, framework-agnostic: plain { name, description?, inputSchema? }
// tools in (OpenAI/Anthropic/MCP lists coerce via coerceCatalog; the
// library's Tool[] via catalogFromTools), a report with a gateable `ok`
// out. Pluggable structural rule pack; thresholds + embedder consumer-
// injected with our defaults. Bin: `agentfootprint-lint-tools`.
// Front door: docs/guides/tool-catalog-lint.md.
export {
  analyzeToolCatalog,
  catalogFromTools,
  coerceCatalog,
  confusabilityText,
  DEFAULT_CONFUSABILITY_THRESHOLD,
  DEFAULT_OMISSION_CUES,
  DEFAULT_WATCH_BAND,
  DEFAULT_WHEN_CUES,
  defaultStructuralRules,
  descriptionRule,
  differentiationHint,
  enumInProseRule,
  formatToolCatalogReport,
  MOCK_EMBEDDER_CALIBRATION,
  optionalParamRule,
  runToolLintCli,
  saysWhatNotWhenRule,
  type AnalyzeToolCatalogOptions,
  type CatalogTool,
  type ConfusablePairFinding,
  type DescriptionRuleOptions,
  type FormatReportOptions,
  type LintRule,
  type LintSeverity,
  type OptionalParamRuleOptions,
  type PairVerdict,
  type SaysWhatNotWhenRuleOptions,
  type SimilarityReport,
  type StructuralFinding,
  type ToolCatalogReport,
  type ToolLintCliIO,
} from './lib/tool-lint/index.js';
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
