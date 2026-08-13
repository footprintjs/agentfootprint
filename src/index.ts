/**
 * agentfootprint — public barrel.
 *
 * Pattern: Facade (GoF) over the typed sublayers.
 * Role:    Single entry point consumers import from.
 * Emits:   N/A.
 */

// Side-effect imports — auto-register v2.6+ cache strategies in the
// strategy registry. Without these, only the wildcard NoOp is
// registered and `Agent.create({ provider: browserAnthropic({...}) })`
// would silently fall back to NoOp instead of using the Anthropic
// cache_control translator. Importing the strategy modules runs their
// `registerCacheStrategy(...)` blocks at module load.
import './cache/strategies/AnthropicCacheStrategy.js';
import './cache/strategies/OpenAICacheStrategy.js';
import './cache/strategies/BedrockCacheStrategy.js';

// Substrate (footprintjs) types consumers reach for when wiring
// recorders + custom executors. Re-exported here so consumer code
// stays "agentfootprint only" — no need to know the substrate name.
// agentfootprint sits ON footprintjs; consumers shouldn't have to
// chase down the substrate to type their CombinedRecorder objects.
export type {
  // Recorder interfaces (the three observation channels)
  CombinedRecorder,
  ScopeRecorder,
  FlowRecorder,
  EmitRecorder,
  // Scope events (data-flow channel)
  WriteEvent,
  ReadEvent,
  CommitEvent,
  StageEvent,
  ErrorEvent,
  // Flow events (control-flow channel)
  FlowStageEvent,
  FlowNextEvent,
  FlowDecisionEvent,
  FlowForkEvent,
  FlowSelectedEvent,
  FlowSubflowEvent,
  FlowSubflowRegisteredEvent,
  FlowLoopEvent,
  FlowBreakEvent,
  FlowErrorEvent,
  TraversalContext,
  // Emit events (consumer-emitted channel)
  EmitEvent,
  // Redaction
  RedactionPolicy,
  RedactionReport,
} from 'footprintjs';

// Adapter interfaces (ports)
export * from './adapters/types.js';

// Injection keys + recorder authoring helpers — needed by anyone writing
// a custom recorder that switches on injection events.
export {
  INJECTION_KEYS,
  injectionKeyForSlot,
  isInjectionKey,
  type InjectionKey,
  // Renderer-facing: classifies a stage's importance (hero vs plumbing) so
  // visualisers (the lens, custom shells) can style the chart. Unlike the
  // slot/id helpers below, this IS consumer API — it exists to be consumed
  // by renderers.
  stageRole,
  type StageRole,
  // Renderer-facing: declares which stages are time-travel MILESTONES (scrub
  // stops) so the lens can build a stage-by-stage slider (iteration → llm-turn
  // → tool-call → decision) instead of stopping only on structural boundaries.
  // Consumer API — owned by the domain, consumed by renderers.
  milestoneFor,
  type Milestone,
  type MilestoneKind,
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
export { type RunContext } from './bridge/eventMeta.js';

// Context-engineering + emit primitives.
//
// The observability recorder FACTORIES (ContextRecorder, streamRecorder,
// agentRecorder, compositionRecorder, costRecorder, evalRecorder,
// memoryRecorder, permissionRecorder, skillRecorder, toolsRecorder,
// contextEvaluatedRecorder, boundaryRecorder, liveStateRecorder, the
// RunStep* family, attachFlowchart/attachLogging/attachStatus, …) now live
// ONLY under `agentfootprint/observe` — the dedicated observability subpath —
// so the main barrel stays focused on the core agent API.
export {
  contextEngineering,
  isEngineeredSource,
  isBaselineSource,
  ENGINEERED_SOURCES,
  BASELINE_SOURCES,
  type ContextEngineeringHandle,
  type ContextEngineeringUnsubscribe,
  type ContextInjectedEvent,
  type ContextInjectedListener,
} from './recorders/core/contextEngineering.js';

// Runner interface + base
export type { EmittedEvent, EnableNamespace, Runner } from './core/runner.js';
export { RunnerBase, makeRunId } from './core/RunnerBase.js';

// What `enable.observability()` / `enable.cost()` / `enable.liveStatus()`
// hand back (8.12.0): the same `Unsubscribe` function, now carrying
// `flush()` / `stop()`. On the main barrel because it is the return type of a
// main-barrel method — the strategy interfaces themselves live on
// `agentfootprint/observe`.
export type { ObservabilityHandle, StrategyHandle } from './strategies/types.js';

// Composition-level UI translation (L1b + L1c). Consumer-facing types
// for `Runner.getUIGroup()` and the per-composition `groupTranslator`
// option. Lens consumes these; any other UI library can too.
export type { GroupKind, GroupMember, GroupMetadata, GroupTranslator } from './core/translator.js';

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
  isCheckInPause,
  isAskPause,
  // 8.13.0 — a consent gate (a tool's `checkIn`, a middleware's `ask`) is
  // answered with a decision, never a value. `pauseDemandsDecision` is how a
  // consumer asks which kind of pause it is holding; `DecisionRequiredError` is
  // what `agent.resume()` raises when the answer is the wrong shape, instead of
  // the silent `by: 'unknown'` decline it filed before.
  pauseDemandsDecision,
  DecisionRequiredError,
  // 8.18.0 — an askHuman/pauseHere pause resumed with NO value. The answer
  // becomes the tool's result, so "no answer" and "carry on" are two different
  // conversations and the caller picks; the library used to pick silently and
  // crash a turn later.
  PauseAnswerRequiredError,
  type ConsentGate,
  type ConsentGateKind,
  type MiddlewareAsk,
  type RunnerPauseOutcome,
} from './core/pause.js';

// The middleware family — a typed chain around every tool dispatch
// (`.toolMiddleware()`) and around the message boundary
// (`.messageMiddleware()`): the input before the model sees it, the output
// before the caller receives it.
//
// Three verbs, and no fourth: `allow()` / `allow(value, why)`, `deny(reason)`,
// `ask({ question })`. There is no way to return a RESULT — the union has no
// arm for one — so whatever a chain decides, the answer the model finally
// reads is the real tool's output or a refusal. A transform commits both the
// original and the replacement, so a scrub is legible in the trace instead of
// silently rewriting history.
export {
  allow,
  ask,
  deny,
  MessageDeniedError,
  type AllowOutcome,
  type AskOutcome,
  type AskPayload,
  type DenyOutcome,
  type MessageDeniedContext,
  type MessageMiddleware,
  type MessageMiddlewareContext,
  type MessageOutcome,
  type MiddlewareDecision,
  type ToolCallMiddleware,
  type ToolMiddleware,
  type ToolMiddlewareContext,
  type ToolOutcome,
  type ToolResultContext,
  type ToolResultMiddleware,
  type ToolResultOutcome,
} from './core/agent/middleware/index.js';

// `.act({ input, beforeTool, afterTool, window, output })` — the five moments
// of the loop in one block, and the canonical way to say what an agent does
// about its own turn. Pure sugar over the five doors above and below; the keys
// are locked at compile time against `LoopMoment`, so the bundle cannot fall
// behind the loop.
export { LOOP_MOMENTS, actKeyFor, type ActKey, type LoopMoment } from './core/agent/moments.js';
export { ACT_KEYS, type ActOptions } from './core/agent/act.js';

// `.watch(observer, …)` — the other half of the sentence `moments.ts` has
// always told: "an observer reports, a rule changes what happens next."
// `.act()` is where a rule may speak; `.watch()` is who is looking while it
// does. Build-time attach, so nothing can act without being watched; the
// runtime door (`agent.attach(o)`, which returns an Unsubscribe) is unchanged.
//
// There is deliberately no `WATCH_MOMENTS`: `.act()`'s keys are a closed list
// because a rule has to be TOLD where it may speak, while an observer attends
// the whole stream and any list we published would be a vocabulary we then had
// to keep true. See `core/agent/watch.ts`.
export type { Watcher } from './core/agent/watch.js';

// Check in with the receipts — evidence-carrying human consent. A tool
// declares `checkIn` (see `defineTool`); when it trips the run pauses with a
// `CheckInRequest` (the ask + evidence pack); a human answers with
// `checkInApproved` / `checkInDeclined`; the `CheckInDecision` lands as a
// typed record (`checkin.request` / `checkin.decision` events + `CheckInRecorder`).
export {
  checkInApproved,
  checkInDeclined,
  isCheckInDecision,
  lexicalDriverScorer,
  standardEvidenceAssembler,
  minimalEvidenceAssembler,
  type CheckInRequest,
  type CheckInEvidence,
  type CheckInContextFrame,
  type CheckInDriver,
  type CheckInTrail,
  type CheckInDecision,
  type CheckInDecisionInput,
  type CheckInDemand,
  type CheckInPredicateContext,
  type CheckInScorer,
  type CheckInScoreInput,
  type CheckInAssembler,
  type CheckInAssemblerInput,
  type EvidencePreset,
  type CheckInBuilderOptions,
} from './core/checkin.js';
// The context-unit shape a `CheckInScorer` ranks — also exported from
// `agentfootprint/observe` (alongside `explainChoice`), surfaced here because it
// is part of the `CheckInScoreInput` contract.
export type { AttributionUnit } from './lib/influence-core/types.js';

// The built-in check-in audit store — `agent.attach(new CheckInRecorder())`.
export {
  CheckInRecorder,
  type CheckInRequestRecord,
  type CheckInDecisionRecord,
  type CheckInStats,
} from './recorders/core/CheckInRecorder.js';

// `enable.flowchart()` stays on the runner, so its public types stay reachable
// from the main barrel. The recorder machinery it (and the other observability
// recorders) are built from — attachFlowchart, buildStepGraph, BoundaryRecorder,
// liveStateRecorder, the RunStep* family, attachLogging, attachStatus — now
// lives ONLY under `agentfootprint/observe`.
export type {
  FlowchartHandle,
  FlowchartOptions,
} from './recorders/observability/FlowchartRecorder.js';

// Commentary — bundled prose templates + engine for narrating a run.
// Consumers ship their own JSON locale / brand voice via the same
// shape; viewers (Lens, CLI tail, log file) consume this surface.
export {
  defaultCommentaryTemplates,
  // Commentary engine helpers — advanced surface consumed by viewer
  // libraries (agentfootprint-lens) to render run narration. Not the
  // everyday API, but de-facto public: keep exported.
  extractAgentName,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
  type CommentaryContext,
  type CommentaryTemplates,
} from './recorders/observability/commentary/commentaryTemplates.js';

// Status — chat-bubble surface (separate audience: the end user
// chatting; renamed from "thinking" in 5.0.0 to disambiguate from the
// MODEL's extended-thinking reasoning). State machine:
// idle / streaming / tool / paused. Same contract shape as commentary
// (`Record<string, string>` with `{{vars}}`, partial overrides
// supported, missing keys ignored) but a different vocabulary —
// first-person status, mid-call only. Per-tool keys (`tool.<toolName>`)
// win over the generic `tool` key.

// Primitives (core/)
export {
  LLMCall,
  LLMCallBuilder,
  type LLMCallInput,
  type LLMCallOptions,
  type LLMCallOutput,
} from './core/LLMCall.js';

// messageAPI merge-tree proof chart (LLM-only) — Context-selector → slot
// subflows → messageAPI assembly stage → Call-LLM. The locked shape that
// will later serve both Static and Dynamic agents. See buildMessageApiChart.
export { type MessageApiChartDeps } from './core/agent/buildMessageApiChart.js';

// Agent (ReAct) form of the merge-tree — Context root selector → two-stage
// convergence: [sf-message-api (system-prompt+messages → messageAPI), sf-tools]
// → Call-LLM → route → [tool-exec → loop] / final. tools + the loop are the
// only additions over buildMessageApiChart. See buildAgentMessageApiChart.
export {
  buildAgentMessageApiChart,
  type AgentMessageApiChartDeps,
} from './core/agent/buildAgentMessageApiChart.js';
export {
  Agent,
  AgentBuilder,
  type AgentInput,
  type AgentOptions,
  type AgentOutput,
  type ObserverDeliveryOptions,
  // `.skillGraph(graph, options)` mount options (SG-C, 9.17.0): routing
  // posture (`strictness`) + cursor span (`continuity`) + per-skill brains,
  // escalation and the tier-3 decider (9.19.0).
  type SkillGraphOptions,
  // Per-skill model switching (9.19.0): a brain is a provider port +
  // optional model — "the cursor picks the brain".
  type ProviderChoice,
  type EscalationPolicy,
} from './core/Agent.js';
// `.window(strategy)` / `.compaction()` — keep the live context window inside
// its budget without ever losing the record. A strategy edits the WINDOW; the
// LEDGER keeps every removed turn byte-identical, and every strategy files its
// own recorded step naming the runtimeStageIds whose messages left.
//
// Three ship, over one turn segmentation and one refusal engine:
//   summarizeOldest  fold the oldest span into a summary  (what `.compaction()` is)
//   slidingWindow    keep the last N turns, drop older ones
//   tokenBudget      counted-token trigger, drop instead of summarize
//
// A commit log lives as long as the process; a conversation lives longer. So
// `.compaction({ retain })` carries the folded originals on the conversation
// checkpoint too, and `foldedSpanFor(conversation, message)` is the door back
// to them after a restart.
export {
  CompactionUnmeasurableError,
  COMPACTED_FRAME_PREFIX,
  DROP_NOTICE_PREFIX,
  foldedMessages,
  foldedSpanFor,
  isCompactedSummary,
  isDropNotice,
  slidingWindow,
  summarizeOldest,
  tokenBudget,
  type CompactionOptions,
  type CompactionRecord,
  type CompactionRetention,
  type FoldedConversation,
  type FoldedSpan,
  type RemovalFacts,
  type RemovalPlan,
  type SlidingWindowOptions,
  type SlidingWindowRecord,
  type TokenBudgetOptions,
  type TokenBudgetRecord,
  type Turn,
  type WindowEviction,
  type WindowRecord,
  type WindowRefusal,
  type WindowRefusalReason,
  type WindowStrategy,
  type WindowStrategyInput,
  type WindowStrategyResult,
} from './core/agent/window/index.js';
// `.selfExplain()` — the in-conversation door over the agent's own trace.
// The options type lives with the other builder-method option types; the
// machinery (traceDebugAgent, toolpack) is on `agentfootprint/observe`.
export type { SelfExplainInclude, SelfExplainOptions } from './lib/trace-toolpack/selfExplain.js';
// RFC-001 Block 10 — deferred observer delivery: the result shape of
// `agent.drainObservers()` + the `snapshot.observerStats` payload
// (re-exported from footprintjs so Agent consumers don't need a direct
// footprintjs import to type them — same precedent as ReadTrackingMode).
export type { ObserverDrainResult, ObserverStats } from 'footprintjs';
// #9 — tool-args validation: the mode for AgentOptions.toolArgValidation.
// (The validator itself is internal; the payload ships as
// Payloads.ValidationArgsInvalidPayload.)
export type { ToolArgValidationMode } from './core/agent/toolArgsValidation.js';
// 9.11.0 — the opt-in tool-result ceiling (`AgentOptions.maxToolResultChars`).
// The marker is what a consumer reads off `stream.tool_end.result` and off the
// `role: 'tool'` message, so the shape AND the guard are public; the measuring
// helper stays internal to dispatch.
export { isTruncatedToolResult, type TruncatedToolResult } from './core/agent/toolResultCap.js';
// #18/#14 — snapshot read-tracking: the mode for AgentOptions.readTracking
// (re-exported from footprintjs so Agent consumers don't need a direct
// footprintjs import to type the option).
export type { ReadSummaryMarker, ReadTrackingMode } from 'footprintjs';
// #P1 — per-write read provenance: the mode for AgentOptions.writeProvenance
// (structurally derived from footprintjs's executor options — the engine owns
// the vocabulary but does not export the alias).
export type { WriteProvenanceMode } from './core/agent/types.js';
export {
  OutputSchemaError,
  applyOutputSchema,
  type OutputSchemaParser,
  type OutputSchemaOptions,
  type OutputSchemaStrategy,
} from './core/outputSchema.js';
// 8.18.0 — the input boundary every runner's `run()` goes through. A bare
// string IS the message (`run('go')` ≡ `run({ message: 'go' })`); anything
// that is not a message is refused by name before the run starts, instead of
// becoming `content: undefined` inside the messages slot.
export { InvalidRunInputError } from './core/runInput.js';
// 7.26 — the loop's side of the output contract. `OutputAttempt` is the row
// shape `snapshot.sharedState.outputAttempts` carries; the frame prefix and
// the tool name are exported so a reader (or a test) can recognise the two
// things this feature puts into a conversation without matching on prose.
export {
  SCHEMA_CHECK_FRAME_PREFIX,
  SCHEMA_TOOL_NAME,
  isSchemaCheckMessage,
  type OutputAttempt,
} from './core/agent/outputEnforcement.js';
export { type OutputFallbackOptions, type OutputFallbackFn } from './core/outputFallback.js';
export {
  canResume,
  ConversationMismatchError,
  RunCheckpointError,
  type AgentRunCheckpoint,
} from './core/runCheckpoint.js';
// 9.10.0 — the CLIENT half of a hosting session: one line in a page that mints
// a session id, keeps it, and hands it back. Exported from the ROOT rather than
// from `agentfootprint/hosting` on purpose — the rest of that door is Node
// (`node:http`, `node:sqlite`) and a browser bundle must not have to reach
// through it. The server half is `nodeHost({ sessionHeader | sessionCookie })`.
export {
  browserSessionId,
  DEFAULT_SESSION_STORAGE_KEY,
  type BrowserSessionIdOptions,
} from './hosting/browserSession.js';
// 9.6.0 — "the request did not fit" as a typed error the adapters translate
// from every vendor's wording, carrying the numbers and the fixes. Exported
// from the ROOT (not `/llm-providers`) because the thing you catch it with is
// `agent.run()`, and because `canResume` classifies on it.
export {
  ContextWindowExceededError,
  ERR_CONTEXT_WINDOW_EXCEEDED,
  isContextWindowExceeded,
} from './adapters/llm/contextWindow.js';
// The conversation refusals (9.2.0) — `instanceof`-able so a caller can tell
// "you are already running" from "somebody is still waiting on an answer" from
// "there is nothing to follow up on".
export {
  NoConversationError,
  PendingQuestionError,
  RunInFlightError,
} from './core/conversation.js';
export {
  flowchartAsTool,
  type FlowchartAsToolOptions,
  type FlowchartResultMapper,
  type FlowchartToolSnapshot,
} from './core/flowchartAsTool.js';
export type {
  Tool,
  ToolExecutionContext,
  ToolRegistryEntry,
  DefineToolOptions,
  // The refusing result ceiling (9.20.0) — a tool's own declared cap that
  // REFUSES teachingly instead of truncating (truncation reads as a complete
  // result and breeds fabrication; a refusal naming how to narrow produces a
  // clean retry). The record keeps the true size (tools.result_refused).
  ToolResultCeiling,
} from './core/tools.js';
export {
  defineTool,
  assertValidToolName,
  assertResultCeiling,
  warnIfInvalidToolName,
} from './core/tools.js';
// Typed tool effects (9.19.0) — the result envelope a tool may return to
// steer the run with DATA instead of string conventions: propose a graph
// transition, push a registered instruction, declare an outcome status. The
// law: push mandatory procedure; pull optional knowledge; never let
// arbitrary text promote itself into control authority.
export {
  explainStatusOnlyNearMiss,
  readToolResultEnvelope,
  TOOL_RESULT_STATUSES,
  type InstructionDeliveryLease,
  type InstructionLease,
  type PendingToolTransition,
  type ProposedEffect,
  type ProposeTransitionEffect,
  type ReadToolResultEnvelope,
  type RequireInstructionEffect,
  type ToolResultEnvelope,
  type ToolResultStatus,
} from './core/agent/toolEffects.js';
// Tool sessions (9.7.0) — the identity a tool holds a session under, and the
// end-signal that releases it. The KEY DERIVATION is exported because it is the
// isolation boundary: one implementation, or two that disagree.
export {
  toolSessionKey,
  hashSessionKey,
  ToolTeardownTimeoutError,
  TOOL_TEARDOWN_TIMEOUT_MS,
  type TeardownScope,
  type TeardownReason,
  type TeardownOptions,
} from './core/toolSessions.js';
export {
  codeRunnerTool,
  toolSessionsOf,
  TOOL_SESSIONS,
  type CodeRunnerToolOptions,
  type CodeRunnerToolScope,
  type HoldsToolSessions,
} from './core/codeRunnerTool.js';
export {
  toolContractCheckup,
  formatToolContractCheckup,
  type ToolContractCheckup,
  type ToolContractProblem,
  type ToolContractCode,
  type ServerToolEntry,
} from './core/toolContract.js';
// Artifacts (9.21.0) — the claim-check store: a tool checks a payload in and
// hands the model a ~26-char claim ticket; the model routes tickets instead
// of hauling data; a later tool redeems them under the run's own scope
// (`ctx.artifacts`, shaped exactly like `ctx.credentials`). Wired via
// `Agent.create({ ..., artifacts })`. On the MAIN barrel because the door is
// an AgentOptions port and the tool capability lives on ToolExecutionContext
// — both main-barrel citizens; the durable adapters load `node:fs` /
// `node:sqlite` lazily at CONSTRUCTION (the sqliteSessions law), so a browser
// bundle walking this barrel never sees them.
export {
  ARTIFACT_REF_PREFIX,
  ArtifactIntegrityError,
  bindArtifacts,
  DEFAULT_IN_MEMORY_ARTIFACT_RETENTION,
  fileArtifacts,
  inMemoryArtifacts,
  InvalidArtifactError,
  isArtifactRef,
  mintArtifactRef,
  sqliteArtifacts,
  unconfiguredArtifacts,
  UnknownParentRefError,
  UnreadableArtifactFileError,
  UnreadableArtifactStoreError,
  type ArtifactEventFact,
  type ArtifactEventSink,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactOp,
  type ArtifactOrigin,
  type ArtifactPutResult,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactRefusalReason,
  type ArtifactRetention,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactSweepReason,
  type BindArtifactsOptions,
  type FileArtifactsOptions,
  type InMemoryArtifacts,
  type InMemoryArtifactsOptions,
  type PutArtifactInput,
  type SqliteArtifacts,
  type SqliteArtifactsOptions,
  type SweptArtifact,
  type ToolArtifactPutInput,
  type ToolArtifacts,
} from './artifacts/index.js';

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
  type ParallelBranchOptions,
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
export {
  workflow,
  Workflow,
  type NextStepInput,
  type WorkflowOptions,
} from './core-flow/Workflow.js';
export {
  graph,
  Graph,
  type GraphEdge,
  type GraphInput,
  type GraphNode,
  type GraphOptions,
  type GraphOutput,
} from './core-flow/Graph.js';

// Adapters — LLM providers
// `mock(...)` is the lowercase factory equivalent to `new MockProvider(...)`.
// `anthropic(...)` is the real Claude provider via `@anthropic-ai/sdk`.
// Zero-peer-dep providers — safe to re-export from the main barrel
// because bundlers walking these never touch optional peer-dep code.
//
// Vendor-SDK-backed providers (AnthropicProvider, OpenAIProvider,
// BedrockProvider) live ONLY at `agentfootprint/providers`. That
// subpath segregation means bundlers walking from `agentfootprint` main
// never see the lazy peer-dep requires for `@anthropic-ai/sdk`,
// `openai`, `@aws-sdk/client-bedrock-runtime`, etc. — automatic
// tree-shaking, no bundler-side workarounds.
//
//   import { AnthropicProvider } from 'agentfootprint';                  // ❌ not exported
//   import { AnthropicProvider } from 'agentfootprint/providers';        // ✓ canonical

export {
  providerFromEnv,
  type ProviderKind,
  type CreateProviderOptions,
  type ProviderFromEnv,
} from './adapters/llm/createProvider.js';

// Streaming helpers — agent events → SSE for browser delivery.

// Injection Engine — the unifying primitive of context engineering.
// One Injection type, four sugar factories, one engine subflow.

// Patterns — factory functions composing primitives + core-flow into
// well-known agent patterns from the research literature.
export * from './patterns/index.js';

// Memory subsystem — narrative beats, fact extraction, embedding-based
// retrieval, and pipelines that compose them. Top-level barrel exports
// the most-used factories; the full subsystem (including types that
// would collide with adapter types like MemoryStore) is reachable via
// the `agentfootprint/memory` subpath import.

// RAG — retrieval-augmented generation as a context-engineering flavor.
// Thin sugar over `defineMemory({ type: SEMANTIC, strategy: TOP_K })`
// plus the `indexDocuments` helper for seeding the corpus at startup.
export {
  defineRAG,
  DEFAULT_CORPUS_IDENTITY,
  type DefineRAGOptions,
  indexDocuments,
  type IndexDocumentsOptions,
  type RagDocument,
} from './lib/rag/index.js';

// The retrieval seam (8.8.0) — what a retrieval considered, and the rule
// that decided what it kept. `topK` is the rule every release before this
// one applied without naming it. The record types are here because a
// consumer reading `agentfootprint.memory.retrieved` needs them.
export {
  topK,
  type TopKOptions,
  type RetrievalStrategy,
  type RetrievalEvidence,
  type RetrievedCandidate,
  type RetrievalRejectReason,
} from './memory/retrieval/index.js';

// MCP + tool dispatch. Tool sources — `mcpClient` / `mockMcpClient`,
// which connect to a Model Context Protocol server and expose its tools
// as agentfootprint `Tool[]` for `agent.tools(...)` — and the dispatch
// primitives `staticTools` / `gatedTools` / `skillScopedTools` live
// ONLY under `agentfootprint/providers`: one subpath for
// everything tool-related, so the main barrel stays focused on the core
// agent API. NONE of them are re-exported here.
// `@modelcontextprotocol/sdk` stays a lazy-required peer-dep, so an app
// that never touches MCP pays nothing for the subpath existing.

// Cross-cutting authorization (v2.5+). `agentfootprint/security` is the
// dedicated subpath; the root barrel also re-exports `PermissionPolicy`
// so existing v2.4 consumers find it at the top level.

// Message Catalog Pattern (v2.5+). `agentfootprint/observe` is the
// dedicated subpath; the root barrel also re-exports the helpers so
// existing v2.4 consumers find them at the top level.
