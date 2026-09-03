/**
 * Agent — ReAct primitive (LLM + tools + iteration loop).
 *
 * Pattern: Builder (GoF) → produces a Runner backed by a footprintjs FlowChart.
 * Role:    Layer-5 primitive (core/). Assembles the 3-slot context
 *          pipeline + callLLM + route decider + tool-calls subflow +
 *          loopTo. Composition nestable anywhere that accepts a Runner.
 * Emits:   Via internal recorders:
 *            agentfootprint.agent.turn_start / turn_end
 *            agentfootprint.agent.iteration_start / iteration_end
 *            agentfootprint.agent.route_decided
 *            agentfootprint.stream.llm_start / llm_end
 *            agentfootprint.stream.tool_start / tool_end
 *            agentfootprint.context.* (via ContextRecorder)
 */

import {
  FlowChartExecutor,
  type AttachRecorderOptions,
  type CombinedNarrativeEntry,
  type CombinedRecorder,
  type CommitValuesMode,
  type FlowChart,
  type FlowchartCheckpoint,
  type ObserverDrainResult,
  type ReadTrackingMode,
  type RunOptions,
  type RuntimeSnapshot,
} from 'footprintjs';
import type { CachePolicy, CacheStrategy } from '../cache/types.js';
import type { ReliabilityConfig } from '../reliability/types.js';
import { ReliabilityFailFastError } from '../reliability/types.js';
import { extractSequence } from '../security/extractSequence.js';
import { PolicyHaltError } from '../security/PolicyHaltError.js';
import { updateSkillHistory as updateSkillHistoryStage } from '../cache/CacheGateDecider.js';
import { getDefaultCacheStrategy } from '../cache/strategyRegistry.js';
import { buildBrainFor, describeServingBrain } from './agent/skillBrains.js';
import { SUBFLOW_IDS } from '../conventions.js';
import {
  DecisionRequiredError,
  assertDecisionIsNotStale,
  isPaused,
  pauseDemandsDecision,
  type RunnerPauseOutcome,
} from './pause.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMToolSchema,
  PermissionChecker,
  PricingTable,
} from '../adapters/types.js';
import type { CredentialProvider } from '../identity/types.js';
import type { ArtifactScope, ArtifactStore } from '../artifacts/types.js';
import { assertArtifactPlacement, type ArtifactPlacement } from '../artifacts/placement.js';
import { recordingPutInput } from '../artifacts/recordingArtifact.js';
import { recordRun, type RunRecorder } from '../recorders/observability/recordRun.js';
import type { AuthorizationRequiredMode } from '../identity/consent.js';
import { CredentialConsentRequiredError } from '../identity/CredentialConsentRequiredError.js';
import type { RunContext } from '../bridge/eventMeta.js';
import { ContextRecorder } from '../recorders/core/ContextRecorder.js';
import { contextEvaluatedRecorder } from '../recorders/core/ContextEvaluatedRecorder.js';
import { streamRecorder } from '../recorders/core/StreamRecorder.js';
import { agentRecorder } from '../recorders/core/AgentRecorder.js';
import { errorBridge } from '../recorders/core/ErrorBridge.js';
import { costRecorder } from '../recorders/core/CostRecorder.js';
import { permissionRecorder } from '../recorders/core/PermissionRecorder.js';
import { evalRecorder } from '../recorders/core/EvalRecorder.js';
import { memoryRecorder } from '../recorders/core/MemoryRecorder.js';
import { embeddingRecorder } from '../recorders/core/EmbeddingRecorder.js';
import { skillRecorder } from '../recorders/core/SkillRecorder.js';
import { validationRecorder } from '../recorders/core/ValidationRecorder.js';
import { credentialRecorder } from '../recorders/core/CredentialRecorder.js';
import { mapRecorder } from '../recorders/core/MapRecorder.js';
import { integrityRecorder } from '../recorders/core/IntegrityRecorder.js';
import { artifactsRecorder } from '../recorders/core/ArtifactsRecorder.js';
import { toolsRecorder } from '../recorders/core/ToolsRecorder.js';
import { reliabilityRecorder } from '../recorders/core/ReliabilityRecorder.js';
import { resilienceRecorder } from '../recorders/core/ResilienceRecorder.js';
import { checkInEventsBridge } from '../recorders/core/CheckInRecorder.js';
import { compactionMeter, type CompactionMeterHandle } from '../recorders/core/CompactionMeter.js';
import { pendingDurableWrite } from './durabilityBarrier.js';
import {
  ToolSessionTier,
  TOOL_TEARDOWN_TIMEOUT_MS,
  type ToolSessionReport,
} from './toolSessions.js';
import { buildEventMeta } from '../bridge/eventMeta.js';
import type { AgentfootprintEventMap } from '../events/registry.js';
import { buildRunManifest } from './agent/runManifest.js';
import { beginIntegrityRun, type IntegrityPosture } from '../integrity/disposition/lifecycle.js';
import type { DispositionLedger } from '../integrity/disposition/ledger.js';
import type { SkillGraphDeclaredMap } from './agent/skillGraphDeclared.js';
import type { AppliedRecipe } from '../recipes/types.js';

/**
 * The pseudo-stage a tool-teardown event is stamped with.
 *
 * `session_closed` and `session_close_failed` fire after the run's last stage
 * has committed — there is no runtimeStageId to inherit, and inventing one that
 * looked like a real stage would put a fictitious node in every consumer's step
 * strip. This says plainly where it came from, the way `'<stageId>#paused'`
 * does at the pause boundary. Their two siblings, `session_started` and
 * `session_reused`, happen inside a real stage and carry its real id.
 */
const TOOL_TEARDOWN_STAGE_ID = 'tool-teardown#0';

/**
 * The pseudo-stage the run-configuration manifest is stamped with (9.41.0).
 *
 * Same reasoning as the teardown id above, at the other end of the run: the
 * manifest is dispatched before the chart starts, so there is no stage to
 * inherit and inventing a plausible one would put a node in every step strip
 * that no traversal ever visited. This says plainly where it came from.
 */
const RUN_MANIFEST_STAGE_ID = 'run-configured#0';
/**
 * Pseudo-stage for `agentfootprint.integrity.disposition` (9.60.0) — the
 * ledger is filed at the run boundary, after the last stage committed, so it
 * states where it came from exactly as the teardown id above does.
 */
const INTEGRITY_DISPOSITION_STAGE_ID = 'integrity-disposition#0';
/**
 * Pseudo-stage for `agentfootprint.skill.graph_declared` (9.50.0) — same
 * reasoning as the manifest id directly above: dispatched before the chart
 * starts, so it states where it came from instead of inheriting a stage no
 * traversal visited.
 */
const GRAPH_DECLARED_STAGE_ID = 'graph-declared#0';
import { EmitBridge } from '../recorders/core/EmitBridge.js';
import { buildWindowStage } from './agent/stages/window.js';
import { requireKeepLastToolResults } from './agent/window/options.js';
import { buildDeliverStage, carriedRoles } from './agent/stages/deliver.js';
import {
  messagesContentRefusal,
  messagesRoleRefusal,
} from '../lib/injection-engine/messagesSlotRefusal.js';
import { CompactionUnmeasurableError } from './agent/window/errors.js';
import type { WindowStrategy } from './agent/window/strategy.js';
import type { FoldedSpan } from './agent/window/types.js';
import {
  isCheckInDecision,
  resolveCheckInConfig,
  type CheckInBuilderOptions,
  type ResolvedCheckInConfig,
} from './checkin.js';
import { assertCostBudgetHasPricing, resolveCostBudget, type ResolvedCostBudget } from './cost.js';
import type { MemoryDefinition } from '../memory/define.types.js';
import type { MemoryStore } from '../memory/store/index.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import type { SelfExplainBinding } from '../lib/trace-toolpack/selfExplain.js';
import {
  causalEvidenceRecorder,
  type CausalEvidenceRecorderHandle,
} from '../memory/causal/evidenceRecorder.js';
import { buildSystemPromptSlot, type SystemPromptSlotArgs } from './slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from './slots/buildMessagesSlot.js';
import { buildToolsSlot, type ProviderToolCache } from './slots/buildToolsSlot.js';
import { isDevMode } from 'footprintjs';
import { buildReadSkillTool } from '../lib/injection-engine/skillTools.js';
import { foldStepPlans } from '../lib/injection-engine/skillSteps.js';
import { buildStepNudgeStage } from './agent/stages/stepNudge.js';
import { buildEvidenceRecheckStage } from './agent/stages/evidenceRecheck.js';
import { toolWantsOf } from './agent/stagedRefs.js';
import { wrapUpStage } from './agent/stages/wrapUp.js';
import { evidenceRefusalSentence } from './agent/evidence/gate.js';
import { UnsupportedValuesError } from './agent/evidence/errors.js';
import type { ResolvedEvidenceGate } from './agent/evidence/types.js';
import { checkerGoverns } from '../adapters/types.js';
import { skillTarget } from '../security/skillTarget.js';
import { buildInjectionEngineSubflow } from '../lib/injection-engine/buildInjectionEngineSubflow.js';
import type { Injection, InjectionContext } from '../lib/injection-engine/types.js';
import type {
  CursorMove,
  EntryScoring,
  TurnRoutingPlan,
} from '../lib/injection-engine/skillGraph.js';
import { makePickEntryStage } from './agent/stages/pickEntry.js';
import { makeRouteTurnStage } from './agent/stages/routeTurn.js';
import {
  applyOutputFallback,
  type ResolvedOutputFallback,
  type OutputFallbackEmit,
} from './outputFallback.js';
import {
  assertContinuable,
  buildCheckpoint,
  classifyFailurePhase,
  RunCheckpointError,
  validateCheckpoint,
  type AgentRunCheckpoint,
  type RunCheckpointTracker,
} from './runCheckpoint.js';
import { NoConversationError, PendingQuestionError, RunInFlightError } from './conversation.js';
import { applyOutputSchema, OutputSchemaError, type OutputSchemaParser } from './outputSchema.js';
import { normalizeRunInput } from './runInput.js';
import type { ResolvedOutputEnforcement } from './agent/outputEnforcement.js';
import { buildOutputRetryStage } from './agent/stages/outputRetry.js';
import { RunnerBase, makeRunId } from './RunnerBase.js';
import type { ToolRegistryEntry } from './tools.js';
import type { ToolProvider } from '../tool-providers/types.js';
import {
  clampIterations,
  validateMemoryIdUniqueness,
  validateToolNameUniqueness,
} from './agent/validators.js';
import type {
  AgentArtifactsOptions,
  AgentInput,
  AgentOptions,
  AgentOutput,
  AgentRecordingsOptions,
  AgentState,
  ExternalGroundsProvider,
  ObserverDeliveryOptions,
  RunConfig,
  RunConfigContext,
  RunConfigFn,
  WriteProvenanceMode,
} from './agent/types.js';
import { buildRouteDeciderStage } from './agent/stages/route.js';
import { buildSeedStage } from './agent/stages/seed.js';
import type { MessageMiddleware, ToolMiddleware } from './agent/middleware/types.js';
import { MessageDeniedError } from './agent/middleware/errors.js';
import { buildCallLLMStage } from './agent/stages/callLLM.js';
import { buildToolCallsHandler } from './agent/stages/toolCalls.js';
import { assertMaxToolResultChars } from './agent/toolResultCap.js';
import type { ToolArgValidationMode } from './agent/toolArgsValidation.js';
import { buildAgentChart } from './agent/buildAgentChart.js';
import { buildDynamicAgentChart } from './agent/buildDynamicAgentChart.js';
import { buildToolRegistry } from './agent/buildToolRegistry.js';
import { AgentBuilder } from './agent/AgentBuilder.js';
export type { SkillGraphOptions } from './agent/AgentBuilder.js';
// Per-skill model switching (9.19.0) — the declared brain shapes.
export type { ProviderChoice, EscalationPolicy } from './agent/skillBrains.js';
import { buildThinkingSubflow } from './slots/buildThinkingSubflow.js';
import { findThinkingHandler } from '../thinking/registry.js';
import type { ThinkingHandler } from '../thinking/types.js';
export { AgentBuilder };

// Re-export public Agent types so the 28+ existing import sites
// (e.g., `import { type AgentInput } from '../core/Agent.js'`) keep
// working while implementation gradually moves into `./agent/*`.
// Public types canonically live in `./agent/types.ts` (v2.11.1).
export type {
  AgentArtifactsOptions,
  AgentInput,
  AgentOptions,
  AgentOutput,
  AgentRecordingsOptions,
  ObserverDeliveryOptions,
  RunConfig,
  RunConfigContext,
  RunConfigFn,
  WriteProvenanceMode,
};

/**
 * `RunOptions` (footprintjs) + agentfootprint-domain correlation fields.
 *
 * `correlationId`/`traceId` are NOT footprintjs concepts — footprintjs's
 * `RunOptions.env` is an intentionally closed infra bag (signal/timeoutMs/
 * traceId only; see footprintjs's `ExecutionEnv`). These two ride separately
 * into `Agent.currentRunContext` and from there into every emitted event's
 * `EventMeta` via `buildEventMeta` (`RunContext` already declares both —
 * `../bridge/eventMeta.ts`), so a caller can join agentfootprint's event
 * stream against an external system (a upstream request id, an OTEL trace,
 * a cross-tier why() join key) without threading it through tool args.
 *
 * `traceId` here wins over `env.traceId` when both are set; `env.traceId`
 * remains a fallback since footprintjs already threads it to subflows.
 */
export interface AgentRunOptions extends RunOptions {
  /** Domain correlation id — forwarded onto every emitted event's `EventMeta.correlationId`. */
  correlationId?: string;
  /** OTEL-style trace id — forwarded onto every emitted event's `EventMeta.traceId`. Falls back to `options.env?.traceId` when unset. */
  traceId?: string;
  /**
   * The hosting CONVERSATION this run belongs to (9.4.0) — forwarded onto
   * every emitted event's `EventMeta.sessionId`, and from there into whatever
   * an observability strategy ships (the CloudWatch/AgentCore adapters
   * serialize the whole envelope, so it arrives without their knowing).
   *
   * `runId` is per run; a session spans many. Without this, a shipped event
   * stream can answer "what happened in this run?" and not "what happened in
   * this conversation?", which is the question a session-oriented host is
   * built around. `standingAgent` sets this for you from the request's own
   * session id, on both `run()` and `resume()`.
   *
   * **It also decides the memory namespace when you named no identity
   * (9.10.0):** a run with a session and no `identity` scopes its memory to
   * `{ conversationId: sessionId }`, because a hosting session IS a
   * conversation. An `identity` you pass always wins. See
   * {@link AgentInput.identity} for the full ladder.
   *
   * Omit it for an unhosted run. It is never derived, guessed, or defaulted to
   * the runId: an absent session and an invented one are different facts.
   */
  sessionId?: string;
  /**
   * Who this run is for — the same tuple as `run({ identity })`, reachable
   * from the doors whose input is a stored conversation rather than a
   * message bag: `resumeOnError(checkpoint, { identity })` and
   * `followUp(message, { identity })` (9.2.0).
   *
   * Before this existed, `resumeOnError` could not carry an identity at all,
   * so every continued turn silently re-namespaced its memory under a fresh
   * runId. Omitted, the conversation's own stored `identity` is used; given,
   * it wins. On `run()` this is a second spelling of `run({ identity })` and
   * the one on the input wins, since that is where the caller looked first.
   */
  identity?: MemoryIdentity;
}

// Public types (AgentOptions, AgentInput, AgentOutput) extracted to
// ./agent/types.ts and re-exported above (v2.11.1).

// AgentState extracted to ./agent/types.ts (v2.11.1).

export class Agent extends RunnerBase<AgentInput, AgentOutput> {
  readonly name: string;
  readonly id: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly temperature?: number;
  private readonly maxTokens?: number;
  private readonly maxIterations: number;
  private readonly systemPromptValue: string;
  /**
   * Cache policy for the base system prompt (set via
   * `.system(text, { cache })`). Default `'always'` — base prompt is
   * stable per-turn, ideal cache anchor. CacheDecision subflow reads
   * this when computing the SystemPrompt slot's cache markers.
   */
  private readonly systemPromptCachePolicy: CachePolicy;
  /**
   * Global cache kill switch from `Agent.create({ caching: 'off' })`.
   * Threaded into agent scope at seed-time as `scope.cachingDisabled`;
   * read by the CacheGate decider every iteration (highest-priority rule).
   */
  private readonly cachingDisabledValue: boolean;
  /**
   * Provider-specific CacheStrategy. Auto-resolved from
   * `getDefaultCacheStrategy(provider.name)` at agent build time
   * unless the consumer explicitly passes one via builder option.
   * Phase 7+ implementations (Anthropic, OpenAI, Bedrock) register
   * themselves in the strategyRegistry on import.
   */
  private readonly cacheStrategy: CacheStrategy;
  private readonly registry: readonly ToolRegistryEntry[];
  /**
   * The Injection list — Skills, Steering, Instructions, Facts (and
   * RAG, Memory). Evaluated each iteration by the
   * InjectionEngine subflow; active set is filtered by slot subflows.
   */
  private readonly injections: readonly Injection[];
  /** Skill-graph cursor resolver (`graph.nextSkill`), set when built via
   *  `.skillGraph(graph)`. Plumbed into the Injection Engine so route triggers
   *  are `from`-gated against the persisted `currentSkillId`. */
  private readonly skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
  /** Skill-graph reachable-set resolver (`graph.reachableSkills`), set when built
   *  via `.skillGraph(graph)`. Plumbed into the tool-calls handler so `read_skill`
   *  is gated to in-graph jumps. Undefined → gate off. */
  private readonly skillGraphReachable?: (currentSkillId?: string) => readonly string[];
  /** Skill-graph relevance entry scorer (`graph.scoreEntries`), set when built via
   *  `.skillGraph(graph)` with `.entryByRelevance()`. Drives the PickEntry stage.
   *  Undefined → no relevance entry routing (cold-start entry as before). */
  private readonly skillGraphScoreEntries?: (
    ctx: InjectionContext,
    signal?: AbortSignal,
  ) => Promise<EntryScoring>;
  /** The `to` end of every edge the mounted graph declares — which skills the graph
   *  WIRES. Empty for a graph-less agent. Read only by `openSkillIds()`. */
  private readonly skillGraphEdgeTargets: ReadonlySet<string>;
  /** Skill-graph cursor resolver that also reports WHICH CLAUSE won
   *  (`graph.explainNextSkill`, 8.5.0). Threaded to the Injection Engine, which
   *  stamps the result on `context.evaluated` as `cursorMove`. Optional — a graph
   *  built before it existed falls back to `nextSkill` and emits no `cursorMove`. */
  private readonly skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove;
  /** Skill-graph suppression reporter (`graph.supersededEntries`, 8.15.0) — the
   *  conditional entries whose `when` matched while the cursor was elsewhere.
   *  Threaded to the Injection Engine, which stamps them on `context.evaluated` as
   *  `supersededIds`. Optional — a graph built before it existed routes identically
   *  and simply emits no `supersededIds`. */
  private readonly skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[];
  /** Is the mounted graph a decision `tree()`? Derived at build time from
   *  `graph.nodes` (a tree is the only shape with `predicate` nodes) — no new
   *  public field on `SkillGraph`. Read for ONE thing: the read_skill gate's
   *  refusal has to explain that a tree has no cursor to jump (8.5.0). */
  private readonly skillGraphIsTree: boolean;
  /** The turn-start cascade wiring (SG-C, 9.17.0) — the graph's routing plan,
   *  the mount's posture/continuity, and the node-id set droppedResume checks
   *  against. Absent (every graph without the new options) → RouteTurn never
   *  mounts, the gate never postures, seed never restores a cursor, and the
   *  checkpoint shape is byte-identical. */
  /** The folded per-skill brains + escalation + decider (9.19.0) —
   *  validated at `AgentBuilder.build()`. Undefined = no brain anywhere:
   *  callLLM, the gate, seed and RouteTurn wire nothing new. */
  private readonly skillBrains?: import('./agent/skillBrains.js').FoldedSkillBrains;
  /**
   * The evidence gate (9.35.0) — `.namesAndNumbersFromEvidence()`, resolved by
   * the builder. Undefined for every agent that did not ask for it, and that
   * undefined is the whole zero-cost guarantee: no decider change, no branch,
   * no scope key, no event.
   */
  private readonly evidenceGate?: ResolvedEvidenceGate;
  /**
   * `.limitsTravelWithTheAnswer()` (this release) — whether the run's declared
   * coverage is folded into the final answer. False for every agent that did
   * not ask for it; the RECORDING half of the coverage primitives does not
   * consult it.
   */
  private readonly limitsTravelWithTheAnswerValue: boolean = false;
  private readonly skillGraphCascade?: {
    readonly turnRouting?: TurnRoutingPlan;
    readonly strictness: 'assist' | 'guard' | 'rails';
    readonly continuity: 'turn' | 'conversation';
    readonly nodeIds: ReadonlySet<string>;
  };
  /** Side channel for the conversation's inherited skill cursor (SG-C) —
   *  stashed by `applyContinuation`, consumed-and-cleared by seed. */
  private pendingResumeSkillCursor?: string;
  private readonly pricingTable?: PricingTable;
  /** Normalized at construction: a bare number is `{ usd, onExceed: 'warn' }`. */
  private readonly costBudget?: ResolvedCostBudget;
  /** Per-slot character budgets (8.11.0). Absent keys keep the slot default. */
  private readonly contextBudget?: AgentOptions['contextBudget'];
  private readonly permissionChecker?: PermissionChecker;
  private readonly toolArgValidation?: ToolArgValidationMode;
  /** The opt-in tool-result ceiling in characters (9.11.0). Absent → results
   *  are never measured. See {@link AgentOptions.maxToolResultChars}. */
  private readonly maxToolResultChars?: number;
  /** Resolved check-in config (evidence-carrying human consent). Always
   *  present — defaults to `standard` evidence + the lexical scorer, so a tool
   *  that declares `checkIn` works even without a `.checkIn()` builder call. */
  private readonly checkInConfig: ResolvedCheckInConfig;
  /** Per-run config resolver from `.configure()`. Undefined for every agent
   *  that never called it — and the chart is then built exactly as before,
   *  with no scope writes and no scope reads added. */
  private readonly runConfigFn?: RunConfigFn;
  /** The agent's one window strategy. Undefined = no window stage, loop
   *  target unchanged, run byte-identical to an agent without it. */
  private readonly windowStrategy?: WindowStrategy;
  /** The tool-dispatch chain (`.toolMiddleware()`), in declaration order.
   *  Empty for every agent that never called it — and then the dispatch loop
   *  never walks a chain, never writes the ledger key, and never emits. */
  private readonly toolMiddleware: readonly ToolMiddleware[];
  /** The message chain (`.messageMiddleware()`), in declaration order. Empty
   *  keeps seed synchronous and prepare-final untouched. */
  private readonly messageMiddleware: readonly MessageMiddleware[];
  /** The instrument the window stage reads mid-run (adapter-reported usage +
   *  per-message provenance). Only ever created alongside a strategy. */
  private readonly compactionMeterHandle?: CompactionMeterHandle;
  /** Snapshot read-tracking policy (#18/#14) — forwarded to the internal
   *  executor. Agent default is `'summary'` (cheap markers), NOT
   *  footprintjs's `'full'`. See AgentOptions.readTracking. */
  private readonly readTracking: ReadTrackingMode;
  /** Commit-log value encoding (#13c-B) — forwarded to the internal
   *  executor. Agent default is `'delta'` (append/delete verbs; growing
   *  arrays like `history` record only their tails — lossless, linear
   *  retained memory), NOT footprintjs's `'full'`. See
   *  AgentOptions.commitValues. */
  private readonly commitValues: CommitValuesMode;
  /** Per-write read provenance (#P1) — forwarded to the internal executor.
   *  Default `'off'` (footprintjs's own): recordings stay byte-identical
   *  unless a consumer opts in. See AgentOptions.writeProvenance. */
  private readonly writeProvenance: WriteProvenanceMode;
  private readonly credentialProvider?: CredentialProvider;
  /** The claim-check store (9.21.0). When set, every tool's `ctx.artifacts`
   *  is this store bound to the run's scope. See AgentOptions.artifacts. */
  private readonly artifactStore?: ArtifactStore;
  /** The placement threshold (9.22.0) — the operator's ref-ing dial from the
   *  object form of AgentOptions.artifacts. Only ever set beside a store. */
  private readonly artifactPlacement?: ArtifactPlacement;
  /** Recordings-as-artifacts (9.26.0) — the operator's dial from the object
   *  form of AgentOptions.artifacts. Only ever set beside a store; absent
   *  means no recorder is ever attached and no run is ever recorded. */
  private readonly artifactRecordings?: AgentRecordingsOptions;
  /** The repeated-call nudge (9.26.0) — `false` only when the operator turned
   *  it off. See AgentOptions.repeatedCallNudge. */
  private readonly repeatedCallNudge?: boolean;
  /** The out-of-budget wrap-up (9.56.0) — `false` only when the operator
   *  turned it off. See AgentOptions.wrapUpAtMaxIterations. */
  private readonly wrapUpAtMaxIterations?: boolean;
  /** The last-tool-result pin (9.57.0) — set only when the operator named a
   *  value other than the default 2. See AgentOptions.keepLastToolResults. */
  private readonly keepLastToolResults?: number | false;
  /** See AgentOptions.integrityPosture (9.60.0). Default 'observe'. */
  private readonly integrityPosture: IntegrityPosture = 'observe';
  /**
   * The per-run disposition ledger, shared with the check sites by
   * REFERENCE through build-time closures (the ProviderToolCache pattern —
   * plumbing, never scope state). `run()` resets it; the run boundary
   * files its report and clears it.
   */
  private readonly integrityLedgerHolder: { current: DispositionLedger | undefined } = {
    current: undefined,
  };
  /** Set at chart build: whether any tool in the FULL declared catalog
   *  (static registry + skill-carried tools) declared `argumentsFrom`. */
  private integrityDanglingPresent = false;
  /** See AgentOptions.noticeEmptyLookups (9.77.0). Default false — absent is
   *  byte-identical, save for the registered not-applicable ledger row. */
  private readonly noticeEmptyLookups: boolean = false;
  /** See AgentOptions.noticePriorTurnEvidence (9.83.0). Default false —
   *  absent is byte-identical, save for the registered not-applicable ledger
   *  row. */
  private readonly noticePriorTurnEvidence: boolean = false;
  /** Set at chart build: whether any tool in the FULL declared catalog
   *  declared `resultColumns` (9.78.0) — the other half of the column-type
   *  contract's arming. */
  private integrityColumnsPresent = false;
  /** See AgentOptions.checkColumnTypes (9.78.0). Default 'off' — absent is
   *  byte-identical, save for the registered not-applicable ledger rows. */
  private readonly checkColumnTypes: 'off' | 'warn' | 'enforce' = 'off';
  /** See AgentOptions.externalGrounds (9.72.0). Absent = door closed,
   *  byte-identical behavior. */
  private readonly externalGrounds?: ExternalGroundsProvider;
  /** What a run does when a declared credential needs 3LO consent (8.6.0).
   *  Default `'pause'`. See AgentOptions.onAuthorizationRequired. */
  private readonly onAuthorizationRequired: AuthorizationRequiredMode;
  /**
   * Consent blocks outstanding in THIS run, keyed by service — the
   * `'tell-model'` honesty ledger, and the only place the authorization URL
   * lives between the block and the caller.
   *
   * It is a plain instance field rather than a scope key on purpose: tracked
   * state is the commit log, which is the snapshot, the narrative and every
   * recording, and this value is a bearer capability. Cleared at the top of
   * every `run()` / `resume()` so one run can never raise on another's block,
   * and cleared per service the moment that credential is issued.
   */
  private readonly consentOutstanding = new Map<
    string,
    {
      readonly service: string;
      readonly authorizationUrl: string;
      readonly sessionId: string;
      readonly tool: string;
      readonly iteration: number;
    }
  >();
  /** Evidence bridge (#5) — present iff a CAUSAL memory is mounted. */
  private readonly causalEvidence?: CausalEvidenceRecorderHandle;
  /** Observer delivery tier (RFC-001 Block 10). `'inline'` (default) is
   *  byte-identical to pre-10 releases; `'deferred'` routes the bridge
   *  recorders + consumer attachments through footprintjs's bounded
   *  capture queue. See AgentOptions.observerDelivery. */
  private readonly observerDelivery: 'inline' | 'deferred';
  /** Queue dials forwarded on every deferred attach (first attach
   *  configures the executor's single dispatcher). */
  private readonly observerDeliveryOptions?: ObserverDeliveryOptions;

  /**
   * Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
   * `appName` is the active actor in narration ("Chatbot called…").
   * `commentaryTemplates` drives Lens's third-person panel.
   * `thinkingTemplates` drives chat-bubble first-person status.
   * Defaults to bundled English; consumer overrides via builder.
   */
  readonly appName: string;
  readonly commentaryTemplates: Readonly<Record<string, string>>;
  readonly thinkingTemplates: Readonly<Record<string, string>>;

  private currentRunContext: RunContext = {
    runStartMs: 0,
    runId: 'pending',
    compositionPath: [],
  };

  // `lastExecutor` is now inherited as a protected field from RunnerBase
  // (single canonical source for footprintjs snapshot access across all
  // runners). Agent's `getLastSnapshot()` delegates to the inherited
  // implementation but is kept here for the JSDoc + clearer return type.

  // The chart is now cached on RunnerBase (`protected chart`) via
  // `initChart()` — built ONCE at constructor time. `getSpec()` returns
  // it. `createExecutor()` reuses it. The earlier `lastFlowChart`
  // field was a per-run workaround for the lazy-build pattern; both
  // are obsolete now. `getSpec()` always returns the same reference
  // the executor traces.

  /**
   * Memory subsystems registered via `.memory()`. Each definition mounts
   * its `read` subflow before the InjectionEngine on every turn; per-id
   * scope keys (`memoryInjectionKey(id)`) keep multi-memory layering
   * collision-free.
   */
  private readonly memories: readonly MemoryDefinition[];

  /**
   * Optional terminal contract. Set via the builder's `.outputSchema()`.
   * When present, `agent.runTyped()` parses + validates the final
   * answer against this parser. `agent.run()` keeps returning the
   * raw string; consumers opt into typed mode explicitly.
   */
  private readonly outputSchemaParser?: OutputSchemaParser<unknown>;
  /**
   * What the LOOP enforces about the output (7.26) — resolved by the builder
   * when `.outputSchema()` was given `retries` or a `'tool-forced'` strategy.
   * Undefined otherwise, and undefined is the whole of the byte-identical
   * path: no branch is mounted, the decider is the function it always was,
   * and the request is the one 7.25 sent.
   */
  private readonly outputEnforcement?: ResolvedOutputEnforcement;

  /**
   * Optional 3-tier degradation for output-schema validation
   * failures. Set via the builder's `.outputFallback({...})`. When
   * present, `parseOutput()` and `runTyped()` fall through:
   *   primary → fallback → canned (in order; canned guarantees no-throw).
   */
  private readonly outputFallbackCfg?: ResolvedOutputFallback<unknown>;

  /** Side-channel for `resumeOnError(...)` — when set, the seed
   *  function restores `scope.history` from this instead of starting
   *  fresh. Cleared on first read so subsequent runs start clean. */
  private pendingResumeHistory?: readonly LLMMessage[];

  /** Its sibling for the folded spans. A restored conversation that dropped
   *  them would carry summaries nobody could unpack — the evidence would be
   *  destroyed by the act of continuing, which is the one thing retention
   *  exists to prevent. Cleared on first read, exactly like the history. */
  private pendingResumeFolded?: readonly FoldedSpan[];

  /** The last completed run's final answer — see `checkpoint()` for why it is
   *  kept here rather than read back from the recording. Undefined after a run
   *  that failed or paused. */
  private lastRunAnswer?: string;

  /** The id the CONSUMER chose, or undefined when they took the default.
   *  `this.id` cannot answer that question — it is `'agent'` either way — and
   *  the stored-conversation fingerprint refuses only on ids somebody picked
   *  (see `AgentRunCheckpoint.agent`). */
  private readonly explicitId?: string;

  /** The identity the caller gave the last run, or undefined when they gave
   *  none. Only an EXPLICIT identity is carried onto `checkpoint()`: the
   *  default is derived from a runId, and storing that would pin a whole
   *  conversation to the id of the one run that started it. */
  private lastRunIdentity?: MemoryIdentity;

  /** How long ONE tool teardown may take before the runner stops waiting.
   *  See `AgentOptions.toolTeardownTimeoutMs`. */
  private readonly toolTeardownTimeoutMs: number;

  /** The run in flight, by id — the whole of the one-turn-at-a-time guard.
   *  Set before the executor is built and cleared in `finally`, so a run that
   *  throws does not leave the agent permanently refusing. */
  private inFlightRunId?: string;

  /** The question a person still owes this agent an answer to. Set when a run
   *  ends paused, cleared by `resume()`, `abandonPause()`, or a run that
   *  completes. Read by the `run()` guard — see `PendingQuestionError`. */
  private pendingQuestion?: {
    readonly toolName?: string;
    readonly toolCallId?: string;
    readonly question?: string;
  };

  /** The `.selfExplain()` binding, when the builder mounted one. Held so
   *  `canExplain()` can answer the same question the trace tools answer, from
   *  the same fact. Undefined on every agent that never called `.selfExplain()`. */
  private selfExplainBinding?: SelfExplainBinding;

  /**
   * Optional `ToolProvider` set via the builder's `.toolProvider()`.
   * When present, the Tools slot subflow consults it per iteration
   * (Block A5 follow-up) — the provider's tools land alongside any
   * tools registered statically via `.tool()` / `.tools()`. The
   * tool-call dispatcher also consults it for per-iteration execute
   * lookup so dynamic chains (`gatedTools`, `skillScopedTools`)
   * dispatch correctly when their visible-set changes mid-turn.
   */
  private readonly externalToolProvider?: ToolProvider;

  /**
   * Optional rules-based reliability config (v2.11.5+). Set via the
   * builder's `.reliability({...})`. When present, every CallLLM
   * execution is wrapped in a retry/fallback/fail-fast loop driven
   * by `preCheck` and `postDecide` rules. Consumed by `buildCallLLMStage`.
   */
  private readonly reliabilityConfig?: ReliabilityConfig;

  /**
   * Resolved ThinkingHandler (v2.14+). Auto-wired by `provider.name`
   * via `findThinkingHandler` UNLESS the builder explicitly set one
   * (or `null` to opt out). When undefined, the NormalizeThinking
   * sub-subflow is NOT mounted at chart build time — zero overhead
   * for non-thinking agents.
   */
  private readonly thinkingHandler?: ThinkingHandler;
  /**
   * v2.14+ — request-side thinking budget. When set, every LLMRequest
   * carries `thinking: { budget }`. AnthropicProvider translates to the
   * wire format. Undefined = no thinking activation (default behavior).
   */
  private readonly thinkingBudget?: number;
  /** Threaded to footprintjs `flowChart()` so every node the Agent
   *  builder creates is observed by these recorders at build time. Set
   *  from `opts.structureRecorders`; undefined when consumer didn't
   *  attach any. */
  private readonly structureRecorders?: readonly import('footprintjs').StructureRecorder[];
  /** Per-COMPOSITION translator (L1b). Set from `opts.groupTranslator`;
   *  undefined when consumer didn't attach one. */
  private readonly agentGroupTranslator?: import('./translator.js').GroupTranslator;
  /** ReAct loop mode — 'dynamic' (default, re-engineer all slots each turn,
   *  flat chart), 'classic' (engineer context once, loop→Messages only, flat
   *  chart), or 'dynamic-grouped' (dynamic semantics + LLM turn wrapped in an
   *  sf-llm-call subflow for richer Lens grouping). Set from `opts.reactMode`.
   *  See AgentOptions. */
  private readonly reactMode: 'classic' | 'dynamic' | 'dynamic-grouped';

  /** The recipes `.recipe()` applied, in declaration order. Held for ONE
   *  purpose: the run manifest's `recipes` rows, so a recording can say which
   *  composition produced the agent that answered. Undefined — never `[]` — on
   *  every agent built without one, which is what keeps the manifest of an
   *  agent that uses no recipes byte-identical to the one it emitted before
   *  they existed. */
  private readonly appliedRecipes?: readonly AppliedRecipe[];
  /** The DECLARED skill map (9.50.0) — nodes + edges verbatim, captured by
   *  `AgentBuilder.skillGraph()`. Filed once per run as
   *  `agentfootprint.skill.graph_declared`; undefined = no graph, or a graph
   *  that could not state its map (the event then never fires). */
  private readonly skillGraphDeclared?: SkillGraphDeclaredMap;
  /** The maps kernel's plan (9.58.0) — present only when built with `.maps()`. */
  private readonly mapsPlan?: import('../maps/engagement/types.js').EngagementPlan;
  /** `.claims()` (9.61.0) — the declared claim contract, or undefined. */
  private readonly claimContract?: readonly import('../integrity/unsupported-claim/check.js').DeclaredClaim[];
  /** `AgentOptions.recordSystemPrompt` (9.50.0) — OFF by default. When true,
   *  every `stream.llm_start` carries the assembled system prompt verbatim as
   *  `systemPromptText`. */
  private readonly recordSystemPromptValue: boolean = false;

  constructor(
    opts: AgentOptions,
    systemPromptValue: string,
    registry: readonly ToolRegistryEntry[],
    voice: {
      readonly appName: string;
      readonly commentaryTemplates: Readonly<Record<string, string>>;
      readonly thinkingTemplates: Readonly<Record<string, string>>;
    },
    injections: readonly Injection[] = [],
    memories: readonly MemoryDefinition[] = [],
    outputSchemaParser?: OutputSchemaParser<unknown>,
    toolProvider?: ToolProvider,
    systemPromptCachePolicy: CachePolicy = 'always',
    cachingDisabled = false,
    cacheStrategy?: CacheStrategy,
    outputFallbackCfg?: ResolvedOutputFallback<unknown>,
    reliabilityConfig?: ReliabilityConfig,
    thinkingHandlerValue?: ThinkingHandler | null,
    thinkingBudgetValue?: number,
    skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined,
    skillGraphReachable?: (currentSkillId?: string) => readonly string[],
    skillGraphScoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>,
    checkInOptions?: CheckInBuilderOptions,
    runConfigFn?: RunConfigFn,
    windowStrategy?: WindowStrategy,
    toolMiddleware?: readonly ToolMiddleware[],
    messageMiddleware?: readonly MessageMiddleware[],
    outputEnforcement?: ResolvedOutputEnforcement,
    skillGraphEdgeTargets?: readonly string[],
    skillGraphExplainNextSkill?: (ctx: InjectionContext) => CursorMove,
    skillGraphIsTree?: boolean,
    skillGraphSupersededEntries?: (ctx: InjectionContext) => readonly string[],
    skillGraphCascade?: {
      readonly turnRouting?: TurnRoutingPlan;
      readonly strictness: 'assist' | 'guard' | 'rails';
      readonly continuity: 'turn' | 'conversation';
      readonly nodeIds: ReadonlySet<string>;
    },
    skillBrains?: import('./agent/skillBrains.js').FoldedSkillBrains,
    evidenceGate?: ResolvedEvidenceGate,
    limitsTravelWithTheAnswer?: boolean,
    recipes?: readonly AppliedRecipe[],
    skillGraphDeclared?: SkillGraphDeclaredMap,
    mapsPlan?: import('../maps/engagement/types.js').EngagementPlan,
    claimContract?: readonly import('../integrity/unsupported-claim/check.js').DeclaredClaim[],
  ) {
    super();
    this.provider = opts.provider;
    this.name = opts.name ?? 'Agent';
    this.id = opts.id ?? 'agent';
    if (opts.id !== undefined) this.explicitId = opts.id;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.maxTokens = opts.maxTokens;
    this.maxIterations = clampIterations(opts.maxIterations ?? 10);
    this.structureRecorders = opts.structureRecorders;
    this.agentGroupTranslator = opts.groupTranslator;
    this.reactMode = opts.reactMode ?? 'dynamic';
    this.systemPromptValue = systemPromptValue;
    this.systemPromptCachePolicy = systemPromptCachePolicy;
    this.cachingDisabledValue = cachingDisabled;
    // Auto-resolve strategy from provider.name unless caller overrides.
    // NoOp is the wildcard fallback so unknown providers stay safe.
    this.cacheStrategy = cacheStrategy ?? getDefaultCacheStrategy(opts.provider.name);
    this.registry = registry;
    this.injections = injections;
    this.skillGraphNextSkill = skillGraphNextSkill;
    this.skillGraphReachable = skillGraphReachable;
    this.skillGraphScoreEntries = skillGraphScoreEntries;
    this.skillGraphEdgeTargets = new Set(skillGraphEdgeTargets ?? []);
    this.skillGraphExplainNextSkill = skillGraphExplainNextSkill;
    this.skillGraphSupersededEntries = skillGraphSupersededEntries;
    this.skillGraphIsTree = skillGraphIsTree ?? false;
    this.skillGraphCascade = skillGraphCascade;
    this.skillBrains = skillBrains;
    this.evidenceGate = evidenceGate;
    this.limitsTravelWithTheAnswerValue = limitsTravelWithTheAnswer === true;
    this.appliedRecipes = recipes;
    this.skillGraphDeclared = skillGraphDeclared;
    this.mapsPlan = mapsPlan;
    this.claimContract = claimContract;
    if (opts.recordSystemPrompt === true) this.recordSystemPromptValue = true;
    this.memories = memories;
    this.outputSchemaParser = outputSchemaParser;
    this.outputEnforcement = outputEnforcement;
    this.outputFallbackCfg = outputFallbackCfg;
    this.externalToolProvider = toolProvider;
    // Eager validation: tool names must be unique across .tool() +
    // every Skill.inject.tools — the LLM dispatches by name. Runs in
    // constructor so `Agent.build()` throws immediately on collision,
    // not at first run().
    validateToolNameUniqueness(registry, injections);
    // Eager validation: memory ids must be unique so per-id scope keys
    // (`memoryInjection_${id}`) don't collide.
    validateMemoryIdUniqueness(memories);
    // Evidence bridge (#5): a CAUSAL memory gets a run-scoped harvest recorder
    // (decisions/toolCalls/iterations/duration/tokens). Attached per run below;
    // its `collect` is threaded into the write mount via chartDeps.
    if (memories.some((m) => m.type === 'causal')) {
      this.causalEvidence = causalEvidenceRecorder();
    }
    // A dial without its switch — refused rather than run as a no-op (8.13.0).
    // Same policy as `observerDeliveryOptions` below; the message and the check
    // are shared with LLMCall, which takes the identical pair.
    assertCostBudgetHasPricing('Agent', opts.pricingTable, opts.costBudget);
    if (opts.pricingTable) this.pricingTable = opts.pricingTable;
    // Normalized once, at build: `onExceed` decides whether the Route decider
    // stops the loop, and a policy resolved per-run could differ per-run.
    const resolvedCostBudget = resolveCostBudget('Agent', opts.costBudget);
    if (resolvedCostBudget !== undefined) this.costBudget = resolvedCostBudget;
    if (opts.contextBudget !== undefined) this.contextBudget = opts.contextBudget;
    if (opts.permissionChecker) this.permissionChecker = opts.permissionChecker;
    if (opts.toolArgValidation !== undefined) this.toolArgValidation = opts.toolArgValidation;
    // The tool-result ceiling (9.11.0). Refused HERE, naming the value, rather
    // than at the first tool call of the first run — a dial that cannot cap
    // anything is a configuration mistake, not a runtime condition.
    assertMaxToolResultChars('Agent', opts.maxToolResultChars);
    if (opts.maxToolResultChars !== undefined) this.maxToolResultChars = opts.maxToolResultChars;
    // Resolve check-in config once. Always present (default: standard evidence
    // + lexical scorer) so a `checkIn`-declaring tool works even without a
    // `.checkIn()` call; the gate only fires for tools that declared `checkIn`.
    this.checkInConfig = resolveCheckInConfig(checkInOptions);
    if (runConfigFn !== undefined) this.runConfigFn = runConfigFn;
    // `.window()` / `.compaction()`: the meter is created ONCE per agent
    // (attached per run, cleared between runs like every other recorder)
    // because the window stage closes over it at chart-build time — and the
    // chart is built once.
    if (windowStrategy !== undefined) {
      this.windowStrategy = windowStrategy;
      this.compactionMeterHandle = compactionMeter();
    }
    // The two governance chains. Empty arrays (not undefined) so every read
    // site is a plain `.length > 0` test rather than an optional dance.
    this.toolMiddleware = toolMiddleware ?? [];
    this.messageMiddleware = messageMiddleware ?? [];
    // Default 'summary' — measurement-gated (#18): stageReads values have
    // zero consumers across af/lens/eui, and 'full' clones ~18MB of unread
    // data per 200 iterations. Consumers opt into 'full' explicitly.
    this.readTracking = opts.readTracking ?? 'summary';
    // Default 'delta' — the accepted #13c-B design: agentfootprint opts in
    // immediately (the agent's history-append workload is exactly the case
    // the verb exists for; reconstruction stays lossless via commitValueAt).
    this.commitValues = opts.commitValues ?? 'delta';
    // Default 'off' — the debugging dial is opt-in: on, every write also
    // records the keys read before it, which is what upgrades `traceVariable`
    // to `coverage: 'exact'` and lets `walkToRoot` hop by recorded dataflow
    // instead of embedding similarity.
    this.writeProvenance = opts.writeProvenance ?? 'off';
    // RFC-001 Block 10 — observer delivery tier. Fail fast on the dials
    // without the switch (no silently-ignored combinations; same policy
    // that merged reactMode/reactStructure in 6.0.0).
    this.observerDelivery = opts.observerDelivery ?? 'inline';
    if (opts.observerDeliveryOptions !== undefined && this.observerDelivery !== 'deferred') {
      throw new Error(
        "Agent: observerDeliveryOptions requires observerDelivery: 'deferred' — " +
          'the dials configure the deferred capture queue and have no meaning inline.',
      );
    }
    this.observerDeliveryOptions = opts.observerDeliveryOptions;
    if (opts.credentials) this.credentialProvider = opts.credentials;
    // Kept only when it says something: `undefined` and `true` are the same
    // default, and storing `true` would make the thread-when-off rule below
    // read as a coincidence.
    if (opts.repeatedCallNudge === false) this.repeatedCallNudge = false;
    // Same discipline (9.56.0): `undefined` and `true` are the same default, so
    // only a deliberate opt-out is stored — which keeps the conditional mount
    // below reading as the decision it is.
    if (opts.wrapUpAtMaxIterations === false) this.wrapUpAtMaxIterations = false;
    // Same discipline (9.57.0): the default is 2, so only a value the
    // operator actually named is stored — which keeps the value-conditional
    // thread into the window stage reading as the decision it is. Refused at
    // construction, never mid-run.
    if (opts.keepLastToolResults !== undefined) {
      requireKeepLastToolResults(opts.keepLastToolResults, 'Agent');
      this.keepLastToolResults = opts.keepLastToolResults;
    }
    // Refused at construction, never mid-run — a misspelled posture that was
    // ignored would leave the liveness theorems switched off in an agent
    // that believes they are on (the concurrency-mode precedent).
    if (opts.integrityPosture !== undefined) {
      if (opts.integrityPosture !== 'observe' && opts.integrityPosture !== 'dev') {
        throw new Error(
          `Agent: integrityPosture must be 'observe' or 'dev', got ` +
            `${JSON.stringify(opts.integrityPosture)}.`,
        );
      }
      this.integrityPosture = opts.integrityPosture;
    }
    // The external-ground door (9.72.0) — refused at construction, never
    // mid-run: a non-function here would otherwise fail on the first LLM call
    // of the first armed run, far from the line that caused it.
    if (opts.externalGrounds !== undefined) {
      if (typeof opts.externalGrounds !== 'function') {
        throw new Error(
          `Agent: externalGrounds must be a function returning {value, source} entries, got ` +
            `${typeof opts.externalGrounds}.`,
        );
      }
      this.externalGrounds = opts.externalGrounds;
    }
    // The write-seam advisory's dial (9.77.0) — refused at construction for
    // the same reason as the posture above: a truthy non-boolean here (a
    // string, a number) would silently arm a check the author only half
    // asked for, and the arming is what decides whether a run is
    // byte-identical to the one before it.
    if (opts.noticeEmptyLookups !== undefined) {
      if (typeof opts.noticeEmptyLookups !== 'boolean') {
        throw new Error(
          `Agent: noticeEmptyLookups must be a boolean, got ` +
            `${JSON.stringify(opts.noticeEmptyLookups)}. It arms the write-seam 'empty-lookup' ` +
            `advisory — a lookup for a value this run itself produced coming back empty. ` +
            `Omit it (or pass false) and no such advisory is ever filed.`,
        );
      }
      this.noticeEmptyLookups = opts.noticeEmptyLookups;
    }
    // The claim seam's recency dial (9.83.0) — refused at construction for
    // the same reason as the write-seam one above: a truthy non-boolean here
    // would silently arm a check the author only half asked for, and the
    // arming is what decides whether a run is byte-identical to the one
    // before it.
    if (opts.noticePriorTurnEvidence !== undefined) {
      if (typeof opts.noticePriorTurnEvidence !== 'boolean') {
        throw new Error(
          `Agent: noticePriorTurnEvidence must be a boolean, got ` +
            `${JSON.stringify(opts.noticePriorTurnEvidence)}. It arms the claim-seam ` +
            `'prior-turn-evidence' advisory — a final answer whose every value was last served ` +
            `before this turn — and it needs \`.namesAndNumbersFromEvidence()\` armed beside ` +
            `it, because that gate owns the extractor that decides which tokens are values. ` +
            `Omit it (or pass false) and no such advisory is ever filed.`,
        );
      }
      this.noticePriorTurnEvidence = opts.noticePriorTurnEvidence;
    }
    // The column-type contract's dial (9.78.0) — refused at construction for
    // the same reason as the postures above, and with one more: `'enforce'`
    // REFUSES tool results, so a misspelling silently downgraded to off would
    // leave an operator believing a boundary is held that nothing is holding.
    if (opts.checkColumnTypes !== undefined) {
      if (
        opts.checkColumnTypes !== 'off' &&
        opts.checkColumnTypes !== 'warn' &&
        opts.checkColumnTypes !== 'enforce'
      ) {
        throw new Error(
          `Agent: checkColumnTypes must be 'off', 'warn' or 'enforce', got ` +
            `${JSON.stringify(opts.checkColumnTypes)}. It reads each tool's declared ` +
            `\`resultColumns\` and judges the rows it returns: 'warn' files findings and ` +
            `changes nothing the model reads; 'enforce' refuses the rows and hands the model a ` +
            `teaching sentence instead. Omit it (or pass 'off') and nothing is ever measured.`,
        );
      }
      this.checkColumnTypes = opts.checkColumnTypes;
    }
    // The claim-check seam (9.21.0). One store per agent, attached at
    // construction — idempotent by shape: there is no second door to attach a
    // competing one through, so "one per agent" is a fact of the type rather
    // than a runtime check. Since 9.22.0 the option also takes the object
    // form `{ store, placement? }` — normalized HERE so every downstream
    // reader keeps seeing exactly one store and one optional dial.
    if (opts.artifacts) {
      if ('store' in opts.artifacts) {
        // The object form. A shape with `placement` but no store cannot be
        // SPELLED in TypeScript, but plain JavaScript can hand us one — and a
        // threshold with nowhere to put what it catches is configuration
        // that lies, so it is refused by name rather than half-read.
        if (opts.artifacts.store === undefined || opts.artifacts.store === null) {
          throw new Error(
            'Agent: artifacts was passed in its object form without a `store`. The placement ' +
              'threshold refs results INTO the store, so it cannot exist without one — pass ' +
              '`artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars } }` (or ' +
              'fileArtifacts / sqliteArtifacts / any ArtifactStore), or drop `artifacts`.',
          );
        }
        assertArtifactPlacement('Agent', opts.artifacts.placement);
        this.artifactStore = opts.artifacts.store;
        if (opts.artifacts.placement !== undefined) {
          this.artifactPlacement = opts.artifacts.placement;
        }
        // The recordings dial (9.26.0). `true` and `{ … }` normalize to ONE
        // shape here, so every downstream reader asks a single question
        // ("is there a recordings option?") rather than re-deriving the union.
        if (opts.artifacts.recordings === true) {
          this.artifactRecordings = {};
        } else if (
          typeof opts.artifacts.recordings === 'object' &&
          opts.artifacts.recordings !== null
        ) {
          this.artifactRecordings = opts.artifacts.recordings;
        }
      } else {
        this.artifactStore = opts.artifacts;
      }
    }
    // The third dial-without-its-switch (8.13.0). `onAuthorizationRequired` is
    // read at exactly one place — the tool-dispatch loop, AFTER
    // `credentials.getCredential` came back `authorization-required`. With no
    // provider that call never returns at all: the fail-closed stand-in
    // (`unconfiguredCredentialProvider`) rejects, so the branch this option
    // governs is unreachable and the setting decides nothing.
    if (opts.onAuthorizationRequired !== undefined && opts.credentials === undefined) {
      throw new Error(
        'Agent: onAuthorizationRequired was set without a `credentials` provider, so it can ' +
          'never be reached — it decides what happens when a DECLARED credential comes back ' +
          "'authorization-required', and with no provider no credential is ever requested (the " +
          'fail-closed stand-in throws instead). Pass `credentials` — agentCoreIdentity({ ' +
          'region }), staticTokens({ … }), or any CredentialProvider from ' +
          "'agentfootprint/security' — or drop `onAuthorizationRequired`.",
      );
    }
    // 8.6.0 — default `'pause'`: consent is work waiting on a person, and the
    // model is the one party that cannot click a link.
    this.onAuthorizationRequired = opts.onAuthorizationRequired ?? 'pause';
    // 9.7.0 — teardown is on the SIGTERM path, so it is bounded by default.
    this.toolTeardownTimeoutMs = opts.toolTeardownTimeoutMs ?? TOOL_TEARDOWN_TIMEOUT_MS;
    if (reliabilityConfig !== undefined) this.reliabilityConfig = reliabilityConfig;
    // v2.14 — Resolve thinking handler. Three states:
    //   - thinkingHandlerValue === undefined → auto-wire by provider.name
    //   - thinkingHandlerValue === null      → opt out (no handler)
    //   - thinkingHandlerValue: ThinkingHandler → explicit override
    // Auto-wire returns undefined for providers without a registered
    // handler (gpt-4o, mistral, etc.), in which case the subflow is NOT
    // mounted at chart build time.
    if (thinkingHandlerValue === null) {
      // explicit opt-out
    } else if (thinkingHandlerValue !== undefined) {
      this.thinkingHandler = thinkingHandlerValue;
    } else {
      const auto = findThinkingHandler(opts.provider.name);
      if (auto) this.thinkingHandler = auto;
    }
    if (thinkingBudgetValue !== undefined) this.thinkingBudget = thinkingBudgetValue;
    this.appName = voice.appName;
    this.commentaryTemplates = voice.commentaryTemplates;
    this.thinkingTemplates = voice.thinkingTemplates;

    // Eager chart construction — see `RunnerBase.initChart` JSDoc.
    // Note re Agent specifics (footprintjs inventor's review):
    // - `providerToolCache: { current: Tool[] }` is closed over by the
    //   chart's Discover + dispatch stages. It's shared across
    //   sequential runs of this Agent instance, but the Discover stage
    //   overwrites `current` at the start of every iteration (line 158
    //   of `buildToolsSlot.ts`), so stale data never reaches a tool
    //   call. Concurrent runs on the SAME Agent instance already share
    //   `currentRunContext` and the recorder dispatcher — eager build
    //   doesn't change that constraint.
    // - `currentRunContext` is read by the per-stage `getRunCtx`
    //   lambda at execution time (not at chart-build time), so a fresh
    //   value per run still flows through correctly.
    this.initChart(() => this.buildChart());
  }

  static create(opts: AgentOptions): AgentBuilder {
    return new AgentBuilder(opts);
  }

  /**
   * Cache policy for the base system prompt. Read by the CacheDecision
   * subflow (v2.6 Phase 4) to know how to treat the SystemPrompt slot's
   * cache markers. Exposed as a method (not direct field access) so
   * the Agent's encapsulation boundary stays clean.
   */
  getSystemPromptCachePolicy(): CachePolicy {
    return this.systemPromptCachePolicy;
  }

  /**
   * The artifact store this agent was built with, or `undefined` when none
   * was attached (9.23.0).
   *
   * For COMPOSERS that resolve refs on the agent's behalf — the hosting
   * layer's `artifact-head` / `artifact-get` wire operations redeem a
   * screen's claim tickets against exactly this store. It is the store, not
   * a scope-bound capability: whoever calls it owns composing the resolution
   * scope (the hosting layer composes the requesting session's identity, the
   * same tuple the run's own tools resolved under). Tools never touch this —
   * `ctx.artifacts` is already bound to the run's scope, and that remains
   * their only door.
   */
  getArtifactStore(): ArtifactStore | undefined {
    return this.artifactStore;
  }

  /**
   * Start recording this run — or do nothing at all (9.26.0).
   *
   * Zero-cost when unused is not a claim here, it is the control flow: with
   * `recordings` unset this returns `undefined` before touching the agent, so
   * no listener is subscribed, no boundary recorder is attached, and the run
   * is byte-identical to every earlier release.
   *
   * It is deliberately the SAME `recordRun` a consumer would call by hand.
   * Nothing about this feature is a second recording implementation — the
   * three connections that a hand-rolled version gets wrong (attach,
   * subscribe, getCommitCount) are wired in exactly one place in this package,
   * and this is a caller of it.
   */
  private startRunRecording(): RunRecorder | undefined {
    if (this.artifactRecordings === undefined || this.artifactStore === undefined) return undefined;
    return recordRun(this);
  }

  /**
   * File the finished recording into the artifact store.
   *
   * ── When ────────────────────────────────────────────────────────────────
   * After the answer is composed, and only for a run that COMPLETED. A pause
   * is not a finished run (the turn continues, and the resume mints its own);
   * a throw never reaches here at all.
   *
   * ── Why it is awaited ───────────────────────────────────────────────────
   * The answer is final before this begins and this cannot change it — but
   * `run()` does return after the write rather than before, and that is a
   * choice rather than an oversight. A fire-and-forget write is a recording
   * lost whenever the process exits with the reply, which is precisely the
   * serverless deployment that wants recordings most. The cost is one store
   * write per turn, stated on the option.
   *
   * ── Why it can never fail the run ───────────────────────────────────────
   * A full store, an unserializable snapshot, a bucket that 500s — none of
   * them are facts about the ANSWER, which is already correct and already
   * paid for. Turning "your recording was not filed" into "your request
   * failed" would be the library deciding that its observability matters more
   * than the user's turn. So every failure degrades to today's path: the
   * answer is returned unchanged and the reason lands on the record as
   * `agentfootprint.artifacts.refused`, where a sink can count it.
   *
   * The recording is FROZEN before the mint, so it can never contain the
   * `artifacts.minted` event describing itself.
   */
  private async fileRunRecording(
    recorder: RunRecorder | undefined,
    outcome: AgentOutput | RunnerPauseOutcome,
  ): Promise<void> {
    const store = this.artifactStore;
    if (recorder === undefined || store === undefined || this.artifactRecordings === undefined) {
      return;
    }
    if (isPaused(outcome)) return;
    const runId = this.currentRunContext?.runId;
    let input;
    try {
      input = recordingPutInput(recorder.toRecording(), {
        ...(runId !== undefined && { runId }),
        ...(this.artifactRecordings.label !== undefined && {
          label: this.artifactRecordings.label,
        }),
      });
    } catch (err) {
      this.reportRecordingRefused(err, 'invalid-input');
      return;
    }
    try {
      const result = await store.put(this.runArtifactScope(), input);
      // Sweeps ride the put result, so retention that evicted an older
      // recording to make room says so on the record — the same law a tool's
      // own mint follows.
      for (const swept of result.swept) {
        this.emit('agentfootprint.artifacts.expired', {
          ref: swept.ref,
          reason: swept.reason,
          kind: swept.kind,
          bytes: swept.bytes,
        });
      }
      this.emit('agentfootprint.artifacts.minted', {
        ref: result.meta.ref,
        kind: result.meta.kind,
        mediaType: result.meta.mediaType,
        bytes: result.meta.bytes,
        ...(result.meta.label !== undefined && { label: result.meta.label }),
        ...(result.meta.expiresAt !== undefined && { expiresAt: result.meta.expiresAt }),
        ...(result.meta.origin !== undefined && { origin: result.meta.origin }),
      });
    } catch (err) {
      this.reportRecordingRefused(err, 'invalid-input');
    }
  }

  /** One refusal fact for a recording that could not be filed. The message is
   *  the store's own, which never carries a payload — only what went wrong. */
  private reportRecordingRefused(err: unknown, reason: 'invalid-input'): void {
    this.emit('agentfootprint.artifacts.refused', {
      op: 'put',
      reason,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  /**
   * The run's artifact scope, read from the finished run's own state.
   *
   * The SAME tuple `ctx.artifacts` bound during the run (`scope.runIdentity`,
   * composed by seed from the caller's identity or derived from the session).
   * Read rather than recomposed: a second derivation here could disagree with
   * the one the run's tools used, and a recording filed in a different scope
   * from the artifacts it describes is a recording nobody can find.
   */
  private runArtifactScope(): ArtifactScope {
    const identity = (this.getLastSnapshot()?.sharedState as Partial<AgentState> | undefined)
      ?.runIdentity;
    if (identity === undefined) {
      // No state to read means no run happened, which this path cannot reach —
      // but a scope is required and inventing a tenant would be worse than a
      // conversation id that names the run itself.
      return { conversationId: this.currentRunContext?.runId ?? 'unknown' };
    }
    return {
      conversationId: identity.conversationId,
      ...(identity.tenant !== undefined && { tenant: identity.tenant }),
      ...(identity.principal !== undefined && { principal: identity.principal }),
    };
  }

  /**
   * The footprintjs `RuntimeSnapshot` from the most recent `run()` /
   * `resume()`. Feeds Lens's Trace tab (ExplainableShell `runtimeSnapshot`
   * prop) so consumers can scrub the execution timeline post-run without
   * threading a recorder through the call site.
   *
   * `undefined` until a run has STARTED. After that it is the most recent
   * run's snapshot — including across multiple turns of the same instance.
   *
   * **It is LIVE during a run, not a completed-runs-only view.** The executor
   * is assigned at run start, so calling this from an event listener, a tool,
   * or any other mid-run vantage point returns the IN-FLIGHT run, partially
   * filled. That is deliberate (Lens scrubs a running agent through it), and
   * it is why `.selfExplain()` captures at the terminal flush instead of
   * resolving through this: evidence that is supposed to describe a FINISHED
   * turn cannot be read from a getter that also answers about an unfinished
   * one.
   */
  getLastSnapshot(): RuntimeSnapshot | undefined {
    return this.lastExecutor?.getSnapshot();
  }

  /**
   * Structured narrative entries from the most recent run. Pairs with
   * `getLastSnapshot()` for ExplainableShell's `narrativeEntries` prop.
   * Empty array (not `undefined`) when no run has completed — matches
   * the prop's expected shape so consumers can wire it directly without
   * a defensive guard.
   */
  getLastNarrativeEntries(): readonly CombinedNarrativeEntry[] {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  /**
   * The FlowChart compiled for the most recent run (or a freshly-built
   * one if no run has happened yet). Feeds ExplainableShell's `spec`
   * prop. Returning the cached chart matters: the spec must match what
   * `getLastSnapshot()` traced, otherwise the Trace view's stage tree
   * desyncs from the snapshot's runtime tree.
   */
  // `getSpec()` inherited from RunnerBase — returns the cached chart
  // built once at constructor time via `initChart()`. Same reference
  // every call, same reference the executor traces.

  // ─── UI group translation (L1b) ───────────────────────────────
  protected override getGroupTranslator(): import('./translator.js').GroupTranslator | undefined {
    return this.agentGroupTranslator;
  }

  /** Agent has no nested-runner members (tools are function executors,
   *  not Runner instances). Slot ids + tool names live in `extra` so
   *  Lens can render an Agent card with slot rows + a tool list without
   *  inspecting `buildTimeStructure`.
   *
   *  Memories are NOT included as members — they're an internal
   *  mechanism, not a composition-level concept. Consumers who need
   *  memory visibility should listen for `agentfootprint.memory.*`
   *  events at runtime. */
  protected override buildUIGroupMetadata(): import('./translator.js').GroupMetadata {
    const toolNames = this.registry.map((r) => r.name);
    return {
      kind: 'Agent',
      id: this.id,
      name: this.name,
      members: [],
      extra: {
        slots: [SUBFLOW_IDS.SYSTEM_PROMPT, SUBFLOW_IDS.MESSAGES, SUBFLOW_IDS.TOOLS] as const,
        toolNames,
        maxIterations: this.maxIterations,
      },
    };
  }

  /**
   * Parse + validate a raw agent answer against the agent's
   * `outputSchema` parser. Throws `OutputSchemaError` on JSON parse
   * or schema validation failure (the rawOutput is preserved on the
   * error for triage). Throws a plain `Error` if the agent has no
   * outputSchema set.
   *
   * Use this when you need to keep `agent.run()` returning the raw
   * string for logging/observability and validate at a different
   * layer; otherwise prefer `agent.runTyped()`.
   */
  parseOutput<T = unknown>(raw: string): T {
    if (!this.outputSchemaParser) {
      throw new Error(
        `Agent.parseOutput: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    return applyOutputSchema(raw, this.outputSchemaParser as OutputSchemaParser<T>);
  }

  /**
   * Async sister of `parseOutput()`. When the agent is configured
   * with `.outputFallback({...})`, this is the version that engages
   * the 3-tier degradation chain on validation failure (the sync
   * `parseOutput` always throws on failure for back-compat).
   *
   * Without `outputFallback`, behaves identically to `parseOutput`
   * — returns sync-style on the happy path, throws OutputSchemaError
   * on validation failure.
   */
  async parseOutputAsync<T = unknown>(raw: string): Promise<T> {
    if (!this.outputSchemaParser) {
      throw new Error(
        `Agent.parseOutputAsync: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    const parser = this.outputSchemaParser as OutputSchemaParser<T>;
    try {
      return applyOutputSchema(raw, parser);
    } catch (err) {
      if (!this.outputFallbackCfg || !(err instanceof OutputSchemaError)) throw err;
      // Engage the 3-tier fallback. The dispatcher gives us the
      // typed-event entry; we synthesize a minimal event shape since
      // these events have no per-stage anchor.
      // Typed via `OutputFallbackEmit`, so the registry — not a grep — is what
      // decides these two names are real. The cast is now only the envelope
      // assembly (type + payload are already checked against the event map).
      const emit: OutputFallbackEmit = (eventType, payload): void => {
        try {
          this.dispatcher.dispatch({
            type: eventType,
            timestamp: Date.now(),
            payload,
          } as unknown as AgentfootprintEventMap[typeof eventType]);
        } catch {
          /* observability errors must not poison the fallback path */
        }
      };
      return applyOutputFallback(
        raw,
        parser,
        this.outputFallbackCfg as ResolvedOutputFallback<T>,
        emit,
        err,
        this.lastRunRetriesSpent(),
      );
    }
  }

  /**
   * Corrective re-asks the agent's LAST run paid for, read off its own ledger.
   *
   * `undefined` when there is no last run to read — `parseOutputAsync` accepts
   * any string, including one that never came from this agent, and reporting
   * `0` for "I do not know" would be an invented fact in an event payload.
   */
  private lastRunRetriesSpent(): number | undefined {
    const state = this.getLastSnapshot()?.sharedState as
      | Pick<AgentState, 'outputAttempts'>
      | undefined;
    if (state === undefined) return undefined;
    return Math.max(0, (state.outputAttempts?.length ?? 1) - 1);
  }

  /**
   * Run the agent and return the schema-validated typed output.
   * Convenience over `parseOutputAsync(await agent.run({...}))`.
   *
   * Throws `OutputSchemaError` on parse / validation failure UNLESS
   * `.outputFallback({...})` is configured, in which case the
   * 3-tier degradation chain (primary → fallback → canned) engages.
   *
   * Throws if the agent has no outputSchema set or if the run
   * pauses (use `run()` directly when pauses are expected).
   */
  async runTyped<T = unknown>(input: AgentInput | string, options?: AgentRunOptions): Promise<T> {
    if (!this.outputSchemaParser) {
      throw new Error(
        `Agent.runTyped: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    const out = await this.run(input, options);
    if (typeof out !== 'string') {
      throw new Error(
        'Agent.runTyped: run paused — typed mode does not support pauses. ' +
          'Use agent.run() + agent.parseOutput(...) after resume.',
      );
    }
    return this.parseOutputAsync<T>(out);
  }

  /**
   * Answer one turn.
   *
   * **`run()` is ONE turn, and it starts a new conversation every time.** The
   * chart seeds its history from this call's `message` alone, so a second
   * `run()` on the same agent does not continue the first: the model is shown
   * one user message and will honestly tell your user it has not spoken to
   * them before. That is deliberate — a primitive that quietly accumulated
   * state across calls could never be used for one-shot work, and a hidden
   * transcript is the most expensive thing an agent can carry.
   *
   * To continue a conversation, name it:
   *
   *   - `agent.followUp(message)` — continue THIS agent's own last completed
   *     run. The one-liner, and what most callers want.
   *   - `run({ message, continueFrom })` — continue a conversation you are
   *     holding: `agent.checkpoint()` from an earlier turn, persisted anywhere
   *     and handed back. Works across a restart, a deploy, or a different
   *     machine, and is what `standingAgent` uses per session.
   *
   * Passing the same `identity.conversationId` to two `run()` calls does NOT
   * continue anything — see {@link AgentInput.identity}. What a registered
   * memory adds is *recall* of prior turns into the system-prompt slot, which
   * is a different thing from the conversation itself.
   *
   * Two refusals guard the per-instance state this agent keeps; both replace
   * behavior that used to succeed while quietly being wrong (9.2.0):
   * {@link RunInFlightError} when a run is already in flight, and
   * {@link PendingQuestionError} when the last run paused to ask a person
   * something that nobody has answered.
   *
   * @example  One turn, then a follow-up
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * await agent.followUp('Make it three.');       // remembers the table
   * ```
   */
  async run(
    input: AgentInput | string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    // Normalize or refuse BEFORE anything is created. A bare string is the
    // message; anything that is not a message is named and refused here
    // rather than becoming `content: undefined` inside the messages slot.
    const runInput = normalizeRunInput<AgentInput>(input, 'Agent.run');
    // Timing next, and before the executor exists: both of these refuse a call
    // that would have SUCCEEDED into corrupted per-instance state or an
    // orphaned human question. See ./conversation.ts for why they are throws.
    this.assertNotRunning('Agent.run');
    this.assertNoPendingQuestion('Agent.run');
    // A conversation handed in continues through the same side channel
    // `resumeOnError` uses — one restoration path, so the two doors cannot
    // drift about what "continue" means. This turn's message IS appended:
    // continuing a conversation adds a turn to it.
    let continued: AgentRunCheckpoint | undefined;
    if (runInput.continueFrom !== undefined) {
      continued = validateCheckpoint(runInput.continueFrom);
      this.applyContinuation(continued, 'Agent.run({ continueFrom })', runInput.message);
    }
    // Only an EXPLICIT identity is remembered for `checkpoint()`; see the
    // field's note. `input.identity` wins over `options.identity` because the
    // input bag is where a caller looks first, and both win over the stored
    // conversation's — but the conversation's is used when neither was given,
    // so a continued turn stays in the namespace it started in.
    this.lastRunIdentity =
      runInput.identity ?? options?.identity ?? (continued ? continued.identity : undefined);
    // Recordings-as-artifacts (9.26.0). BEFORE `createExecutor`, because
    // `attach()` collects recorders for the executor that has not been built
    // yet — a recording started one line later would be missing its
    // boundaries, which is the failure mode `recordRun` exists to prevent.
    // Returns `undefined` (and touches nothing) unless the dial is on.
    const recording = this.startRunRecording();
    // (helper used in the catch block below — module-private function
    // declared at file end via hoisting)
    const executor = this.createExecutor(options);
    this.inFlightRunId = this.currentRunContext.runId;
    // One disposition ledger per run (9.60.0) — registration mirrors what
    // this agent's configuration makes applicable; dev posture runs the
    // canaries here, BEFORE any real work, so a dead check is named first.
    this.beginIntegrityLedger();

    // Auto-checkpoint at iteration boundaries — captures the latest
    // conversation history into a per-run tracker. On error, we
    // wrap the underlying error in `RunCheckpointError` carrying
    // this checkpoint so `agent.resumeOnError(checkpoint)` can
    // continue from the last good iteration.
    const tracker: RunCheckpointTracker = {
      runId: this.currentRunContext?.runId ?? 'unknown',
      originalInput: { message: runInput.message },
      history: [],
      lastCompletedIteration: 0,
    };
    const stopTracking = this.installCheckpointTracker(tracker);
    // The answer this run produces is the only place the final assistant turn
    // exists (nothing writes it back into `scope.history`), so `checkpoint()`
    // keeps it. Cleared here so a failed or paused run cannot hand back the
    // previous run's answer.
    this.lastRunAnswer = undefined;
    // One run can never raise on another run's consent block.
    this.consentOutstanding.clear();

    try {
      const result = await executor.run({
        input: {
          message: runInput.message,
          ...(this.lastRunIdentity !== undefined && { identity: this.lastRunIdentity }),
        },
        // Co-engineered boundary (#16): the engine's loop-iteration limit
        // (footprintjs 9 default 1000) must never fire BELOW the agent's own
        // budget — give it headroom (×2 + 10 covers double-hop loop shapes).
        // Consumer-provided options win.
        maxIterations: this.maxIterations * 2 + 10,
        ...(options ?? {}),
      });
      const finalized = this.finalizeResult(executor, result);
      if (typeof finalized === 'string') this.lastRunAnswer = finalized;
      this.recordPendingQuestion(finalized);
      await this.endRunToolSessions(finalized);
      // The answer is FINISHED before this line and cannot be changed by it.
      // The liveness theorems (9.60.0, dev posture only) — a run that would
      // return green while its registered checkers demonstrably never ran
      // fails HERE instead, before the recording is filed. A finished run is
      // itself the proof work existed: the loop cannot finish without at
      // least one model call.
      this.assertIntegrityAlive();
      // See `fileRunRecording` for why the write is awaited rather than left
      // in flight, and why it can never fail the run.
      await this.fileRunRecording(recording, finalized);
      return finalized;
    } catch (cause) {
      // A THROWN pause is still a pause — see `endRunToolSessions`.
      await this.endRunToolSessions(cause);
      // Wrap recoverable errors with the last-known-good checkpoint.
      // Don't wrap intentional terminal signals — let them propagate as
      // their typed shapes so callers can `instanceof` them:
      //   • PauseSignal — askHuman pause, not a failure
      //   • PolicyHaltError — policy-driven termination; resuming would
      //     immediately re-trigger the same halt (the synthetic
      //     tool_result is already in history)
      //   • ReliabilityFailFastError — finalizeResult constructs and
      //     throws this AFTER the chart returns cleanly, so it never
      //     enters this catch (kept here for documentation only)
      const isTerminalTypedError =
        cause instanceof Error &&
        (cause.name === 'PauseSignal' ||
          cause instanceof PolicyHaltError ||
          cause instanceof ReliabilityFailFastError ||
          // A provider that reports no usage will report none on resume
          // either — wrapping this in a checkpoint would invite the caller to
          // retry into the same wall.
          cause instanceof CompactionUnmeasurableError ||
          // 8.6.0 — a consent block is answered by a PERSON at the identity
          // provider, not by replaying the run. Wrapping it in a crash
          // checkpoint would hand the caller a retry handle for a wall, and
          // would bury the `authorizationUrl` one `.cause` deep where the
          // person who has to click it will not look.
          cause instanceof CredentialConsentRequiredError ||
          // 9.35.0 — an evidence refusal is a VERDICT, not a crash: the run
          // finished, the loop already spent its one revision, and resuming
          // would put the same model in front of the same evidence. Wrapping
          // it would hand the caller a retry handle for a wall and bury the
          // named values one `.cause` deep, where the person deciding what to
          // do about them will not look.
          cause instanceof UnsupportedValuesError ||
          // 9.60.0 — a dead checker is a WIRING verdict on this build, not a
          // recoverable run state: resuming would run the same dead wiring.
          cause.name === 'CheckerDeadError');
      if (cause instanceof Error && !isTerminalTypedError && tracker.history.length > 0) {
        // Observation beats the heuristic: if a bracket was open, it says
        // exactly what the run was doing. `classifyFailurePhase` only decides
        // when nothing was — a failure between brackets, where the error's own
        // text really is the best evidence available (8.14.0).
        const observed = tracker.inFlightPhase;
        const checkpoint = buildCheckpoint(
          tracker,
          {
            iteration: tracker.inFlightIteration ?? tracker.lastCompletedIteration + 1,
            phase: observed?.phase ?? classifyFailurePhase(cause),
            ...(observed !== undefined && { stage: observed.stage }),
          },
          // Read from the live snapshot rather than the tracker: the tracker
          // follows `history` through iteration_end events, and a fold's spans
          // are committed state. A crash checkpoint that carried the summary
          // in its history but not the span behind it would resume into a
          // conversation whose evidence the crash had quietly eaten.
          this.foldedSpansOf(this.getLastSnapshot()?.sharedState as Partial<AgentState>),
          // A crash checkpoint is the same conversation carrier as
          // `checkpoint()`, so it carries the same two owner facts — otherwise
          // resuming after a crash would be the one path that still lost the
          // identity, and the memory written after the recovery would land
          // where nothing could read it.
          this.conversationOwner(),
          // …and the same graph cursor (SG-C), from the same snapshot reader —
          // one reader, two carriers, so neither can lose what the other keeps.
          this.continuityCursorOf(this.getLastSnapshot()?.sharedState as Partial<AgentState>),
        );
        throw new RunCheckpointError(cause, checkpoint);
      }
      throw cause;
    } finally {
      // The run's disposition rows, on EVERY path — success, failure, pause —
      // and BEFORE the recording stops, so a recording carries its run's
      // checker accounting (9.60.0).
      this.fileIntegrityDisposition();
      // Always released: a recording left subscribed would keep listening
      // through the next run and grow a tail nobody reads.
      recording?.stop();
      stopTracking();
      this.inFlightRunId = undefined;
      // `seed` consumes the restored conversation on its way past. A run that
      // died BEFORE seed never did, and a history left armed here would be
      // picked up by the next run — which would then continue a conversation
      // nobody asked it to. One run, one continuation.
      this.pendingResumeHistory = undefined;
      this.pendingResumeFolded = undefined;
      this.pendingResumeSkillCursor = undefined;
    }
  }

  /**
   * Continue this agent's own last completed conversation.
   *
   * The one-liner for turn two and after. `run()` is one turn and starts a new
   * conversation each time (see {@link Agent.run}); this reads the
   * conversation off the last completed run, appends `message` as the next
   * user turn, and runs from there — so the model sees what was actually said.
   *
   * Sugar over `run({ message, continueFrom: this.checkpoint() })` and nothing
   * more: one restoration path, so the convenience cannot drift from the
   * mechanism. Reach for `run({ continueFrom })` directly when the
   * conversation comes from somewhere other than this instance's last run — a
   * store, another process, a different machine.
   *
   * Refuses rather than guessing: {@link NoConversationError} when this agent
   * has no completed run to continue (a "follow-up" that quietly became a
   * first turn would be exactly the confusion this door exists to remove),
   * and — through `run()` — {@link PendingQuestionError} when the last run
   * paused to ask a person something, because a pause has its own door:
   * `resume(checkpoint, decision)`.
   *
   * The conversation grows every turn and nothing here trims it; bounding what
   * the model is shown is `.window()` / `.compaction()` / `.memory()`, not a
   * silent cap on the way through.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * await agent.followUp('Make it three.');
   * await agent.followUp('And move it to 8pm.');
   * ```
   */
  async followUp(
    message: string,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    // Refuse BEFORE the timing guards, so "there is nothing to follow up on"
    // is never reported as "a run is in flight" for an agent that has simply
    // not run yet.
    if (this.getLastSnapshot() === undefined) {
      throw new NoConversationError('Agent.followUp', 'never-run');
    }
    const conversation = this.checkpoint();
    if (conversation === undefined || conversation.history.length === 0) {
      throw new NoConversationError('Agent.followUp', 'last-run-unfinished');
    }
    return this.run({ message, continueFrom: conversation }, options);
  }

  /**
   * Drop the question this agent's last run paused to ask, on the record.
   *
   * A paused run is waiting on a person. Sending a different message while one
   * is outstanding is refused ({@link PendingQuestionError}) because silently
   * discarding a pending question makes a consent gate something any later
   * message can walk around. When the question really is being dropped —
   * the user changed the subject, the session timed out, the approval is no
   * longer wanted — say so with this, and the next `run()` proceeds.
   *
   * Returns what was dropped (`undefined` when nothing was pending), so a
   * caller can log or audit the abandonment rather than perform it blind. It
   * does not touch the paused run's checkpoint: if you still hold that, it
   * remains resumable.
   */
  abandonPause():
    | { readonly toolName?: string; readonly toolCallId?: string; readonly question?: string }
    | undefined {
    const dropped = this.pendingQuestion;
    this.pendingQuestion = undefined;
    return dropped;
  }

  /**
   * Whether {@link Agent.selfExplain}'s why-questions have a run to answer
   * from right now.
   *
   * `false` for two different reasons, both honest: this agent was not built
   * with `.selfExplain()`, or it was and no turn has completed yet (evidence
   * binds at the END of a run, never to the one in flight). Either way there
   * is nothing to explain, which is what a caller routing a why-question needs
   * to know before it routes.
   *
   * The model is told the same thing by the same fact — the trace tools answer
   * "No completed run is available yet" and the skill body says to say so
   * plainly. This is that answer, for the program.
   */
  canExplain(): boolean {
    return this.selfExplainBinding?.artifacts !== undefined;
  }

  /**
   * Resume an agent run from a checkpoint produced by a prior
   * `RunCheckpointError`. Unlike `agent.resume()` (which takes a
   * `FlowchartCheckpoint` from an intentional pause), this takes
   * an `AgentRunCheckpoint` (conversation-history snapshot) and
   * replays the agent run with that history restored.
   *
   * The next iteration retries the call that originally failed —
   * with the latest provider state (circuit breaker may have
   * closed, vendor may have recovered, etc.).
   *
   * **Resume = REPLAY from the last completed iteration boundary,
   * not exact-state restore.** Only the conversation history is
   * restored; everything else re-seeds fresh:
   *
   *   - **Tool re-execution / idempotency**: tool side effects from
   *     the FAILED iteration are not in the checkpoint. The model
   *     re-decides from the restored history and may re-issue those
   *     tool calls — they WILL execute again (there is no built-in
   *     toolCallId dedup). Mutating tools (payments, emails, DB
   *     writes) must be idempotent — key on stable call content, not
   *     `ctx.toolCallId` (a re-issued call gets a new id).
   *   - **Fresh `runId`**: the resumed run's events carry a new
   *     `runId`; use `checkpoint.runId` to correlate back to the
   *     failing run.
   *   - **Iteration counter + budget reset**: the resumed run starts
   *     at iteration 1 with a full `maxIterations` budget
   *     (`checkpoint.lastCompletedIteration` is diagnostic only).
   *     Token/cost accumulators also restart at zero.
   *
   * @example
   * ```ts
   * try {
   *   const result = await agent.run({ message: 'long task' });
   * } catch (err) {
   *   if (err instanceof RunCheckpointError) {
   *     await checkpointStore.put(sessionId, err.checkpoint);
   *     // hours / restart later:
   *     const checkpoint = await checkpointStore.get(sessionId);
   *     const result = await agent.resumeOnError(checkpoint);
   *   }
   * }
   * ```
   */
  async resumeOnError(
    checkpoint: AgentRunCheckpoint | unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    const cp = validateCheckpoint(checkpoint);
    // The timing guards run HERE, not only inside `run()`, because the line
    // below writes the side channel: a refusal after that write would leave a
    // restored history armed and the NEXT run would silently continue somebody
    // else's conversation.
    this.assertNotRunning('Agent.resumeOnError');
    this.assertNoPendingQuestion('Agent.resumeOnError');
    // Stash the checkpointed history on the side channel; the seed function
    // reads + clears it before scope.history initializes. No message is
    // appended — the failing run's message is already the last user turn in
    // that history, and adding it again would ask twice.
    this.applyContinuation(cp, 'Agent.resumeOnError');
    return this.run(
      {
        message: cp.originalInput.message,
        // The conversation's own identity, unless this call named one. Until
        // 9.2.0 there was no way to pass either, so a recovered run silently
        // re-namespaced its memory under a fresh runId and wrote turn two
        // where turn three could not read it.
        ...(this.identityFor(options, cp) !== undefined && {
          identity: this.identityFor(options, cp),
        }),
      },
      options,
    );
  }

  /**
   * Which identity a continued turn runs under: the caller's if they named
   * one, otherwise the conversation's own.
   *
   * @internal
   */
  private identityFor(
    options: AgentRunOptions | undefined,
    cp: AgentRunCheckpoint,
  ): MemoryIdentity | undefined {
    return options?.identity ?? cp.identity;
  }

  /**
   * Install a per-run checkpoint tracker. Listens for the agent's
   * own iteration_end events on `this.dispatcher` and snapshots the
   * conversation history into the tracker. Returns a stop function.
   *
   * @internal
   */
  private installCheckpointTracker(tracker: RunCheckpointTracker): () => void {
    const offIterStart = this.dispatcher.on(
      'agentfootprint.agent.iteration_start' as never,
      ((event: { payload?: { iterIndex?: number } }) => {
        const p = event.payload;
        if (typeof p?.iterIndex === 'number') tracker.inFlightIteration = p.iterIndex;
      }) as never,
    );
    // Phase OBSERVATION (8.14.0) — the run's own stream brackets, on the
    // dispatcher this tracker is already listening to. A crash inside one of
    // these is attributable without asking the error to describe itself.
    // `'call-llm'` is a literal and `toolName` is a name the app declared:
    // no URL, no credential, no payload ever reaches the checkpoint.
    const offLlmStart = this.dispatcher.on(
      'agentfootprint.stream.llm_start' as never,
      (() => {
        tracker.inFlightPhase = { phase: 'llm', stage: 'call-llm' };
      }) as never,
    );
    const offLlmEnd = this.dispatcher.on(
      'agentfootprint.stream.llm_end' as never,
      (() => {
        tracker.inFlightPhase = undefined;
      }) as never,
    );
    const offToolStart = this.dispatcher.on(
      'agentfootprint.stream.tool_start' as never,
      ((event: { payload?: { toolName?: string } }) => {
        const name = event.payload?.toolName;
        tracker.inFlightPhase = { phase: 'tool', stage: typeof name === 'string' ? name : 'tool' };
      }) as never,
    );
    const offToolEnd = this.dispatcher.on(
      'agentfootprint.stream.tool_end' as never,
      (() => {
        tracker.inFlightPhase = undefined;
      }) as never,
    );
    const offIterEnd = this.dispatcher.on(
      'agentfootprint.agent.iteration_end' as never,
      ((event: { payload?: { iterIndex?: number; history?: ReadonlyArray<unknown> } }) => {
        const p = event.payload;
        if (typeof p?.iterIndex === 'number') tracker.lastCompletedIteration = p.iterIndex;
        if (Array.isArray(p?.history)) {
          tracker.history = p.history as readonly LLMMessage[];
        }
        tracker.inFlightIteration = undefined;
        tracker.inFlightPhase = undefined;
      }) as never,
    );
    return () => {
      offIterStart();
      offIterEnd();
      offLlmStart();
      offLlmEnd();
      offToolStart();
      offToolEnd();
    };
  }

  async resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: AgentRunOptions,
  ): Promise<AgentOutput | RunnerPauseOutcome> {
    // ── A consent gate is answered with a DECISION (8.13.0) ─────────────
    // Refused HERE, before the engine is handed the checkpoint, so nothing
    // executes and the checkpoint is unchanged — the caller can answer the same
    // one and resume again. Before this, a mis-shaped resume silently DECLINED
    // and filed `by: 'unknown'`: a consent record naming a person who was never
    // asked. Governance never silently invents a decision, for the same reason
    // it never silently drops one.
    //
    // Discriminated by the PAUSE, never by the input: a plain askHuman/pauseHere
    // answer is a value (often a string) and must stay accepted, so the only
    // sound question is "what was asked?".
    const gate = pauseDemandsDecision(checkpoint.pauseData);
    if (gate && !isCheckInDecision(input)) throw new DecisionRequiredError(gate, input);
    // And the answer must be about the thing that was asked. Checked HERE, at
    // the same door and before any state moves, because a resume that has begun
    // is a resume that has already used the value.
    assertDecisionIsNotStale(checkpoint.pauseData, input);
    // The same one-turn-at-a-time guard `run()` carries: a resume writes the
    // same per-instance state a run does. Answering the question is what this
    // door is FOR, so it never checks `pendingQuestion` — it clears it.
    this.assertNotRunning('Agent.resume');
    // Settled the moment the answer is handed over, not when the resumed run
    // finishes: a resume that then FAILS must not leave the agent refusing
    // every later message on behalf of a question that has been answered.
    this.pendingQuestion = undefined;
    this.emitPauseResume(checkpoint, input);
    // Fresh executor — footprintjs 4.17.0+ seeds the runtime from
    // `checkpoint.sharedState` (and nested subflow states) automatically
    // on a fresh executor's `resume()`. No need to retain a paused
    // executor between run/resume.
    // Recorded on the same terms a fresh run is (9.26.0) — and the recording
    // covers the RESUMED run, which is what the recorder saw. A turn that
    // paused and resumed is two runs, and each mints its own recording when
    // (and only when) it completes.
    const recording = this.startRunRecording();
    const executor = this.createExecutor(options);
    this.inFlightRunId = this.currentRunContext.runId;
    // A resumed turn is two runs, and each keeps its own ledger — exactly
    // the recording's terms one comment up.
    this.beginIntegrityLedger();
    this.lastRunAnswer = undefined;
    // One run can never raise on another run's consent block.
    this.consentOutstanding.clear();
    try {
      const result = await executor.resume(checkpoint, input, options);
      const finalized = this.finalizeResult(executor, result);
      if (typeof finalized === 'string') this.lastRunAnswer = finalized;
      // The question this resume answered is settled; a resume that paused
      // AGAIN has asked a new one, and that one is outstanding from here.
      this.recordPendingQuestion(finalized);
      await this.endRunToolSessions(finalized);
      // Same liveness gate the fresh-run path applies (9.60.0).
      this.assertIntegrityAlive();
      await this.fileRunRecording(recording, finalized);
      return finalized;
    } catch (cause) {
      await this.endRunToolSessions(cause);
      throw cause;
    } finally {
      // Same terms as the fresh-run path: rows on every exit, before the
      // recording stops (9.60.0).
      this.fileIntegrityDisposition();
      recording?.stop();
      this.inFlightRunId = undefined;
    }
  }

  /**
   * Fire `'run'`-scoped tool teardown — IF this run really ended.
   *
   * **Not on `finally`, and that is the whole point.** `finally` runs on every
   * exit including a pause, and a pause exits TWO ways: a returned
   * `RunnerPauseOutcome` and a thrown `PauseSignal`. A check-in on a
   * code-interpreter call pauses the run so a person can approve the code —
   * tearing the sandbox down there destroys the exact state the resume needs,
   * and it fails QUIETLY, as a resumed run that "just re-ran everything".
   * Both shapes are discriminated here and both are skipped.
   *
   * An error IS a terminal: the run is over, nobody is coming back, and a
   * sandbox held by a run that crashed is the clearest kind of leak. Only a
   * pause survives.
   *
   * Fired for the TURN, not for `currentRunContext.runId` — `resume()` mints a
   * fresh run id, so a pause and its resume are one turn across two runs, and
   * filtering on the id would leave everything a paused turn opened alive
   * forever. See `ToolSessionTier.fireRun`.
   *
   * @param outcome what `run()`/`resume()` is about to return, or about to throw.
   */
  private async endRunToolSessions(outcome: unknown): Promise<void> {
    if (!this.toolSessionTier) return;
    if (isPaused(outcome)) return;
    if (outcome instanceof Error && outcome.name === 'PauseSignal') return;
    await this.toolSessionTier.fireRun();
  }

  /**
   * The conversation this agent's LAST completed run leaves behind, packed as
   * the same `AgentRunCheckpoint` that `resumeOnError(...)` accepts. Store it,
   * hand it back next turn, and the agent continues where it left off — across
   * a restart, a deploy, or a different machine.
   *
   * Returns `undefined` before any run has completed.
   *
   * **Read from the run's own recording, not from a second copy.** The history
   * comes from `getLastSnapshot().sharedState.history` — the state the run
   * actually committed — cloned on the way out so a persistence layer can never
   * mutate the live heap. The final assistant turn is appended from the answer
   * `run()` returned, because nothing ever writes it back into `history`: the
   * loop appends assistant turns only when they carry tool calls, and the turn
   * that ends the run carries none. An agent that stored this conversation
   * without that append would drop its own reply every turn and answer the next
   * one having forgotten what it just said.
   *
   * Adds no events, no scope writes and no capture: every recording is
   * byte-identical to an agent that never calls this.
   *
   * After a run that **paused**, this is the conversation as of the pause, with
   * no answer appended — a pause is unfinished work, and pause/resume has its
   * own carrier (`FlowchartCheckpoint`) that holds engine state this shape
   * cannot.
   *
   * The conversation grows every turn and nothing here trims it. Bounding what
   * the model is shown is the memory subsystem's job (`.memory(...)`), not a
   * silent cap applied on the way to storage.
   *
   * @example
   * ```ts
   * await agent.run({ message: 'Book me a table for two.' });
   * const conversation = agent.checkpoint();          // persist anywhere
   * // …a restart later, on a fresh Agent:
   * await agent.resumeOnError({
   *   ...conversation,
   *   history: [...conversation.history, { role: 'user', content: 'Make it three.' }],
   *   originalInput: { message: 'Make it three.' },
   * });
   * ```
   */
  checkpoint(): AgentRunCheckpoint | undefined {
    const snapshot = this.getLastSnapshot();
    if (!snapshot) return undefined;
    const state = snapshot.sharedState as Partial<AgentState> | undefined;
    const recorded = (state?.history ?? []) as readonly LLMMessage[];
    const history = structuredClone(recorded) as LLMMessage[];
    if (this.lastRunAnswer !== undefined && this.lastRunAnswer.length > 0) {
      history.push({ role: 'assistant', content: this.lastRunAnswer });
    }
    const folded = this.foldedSpansOf(state);
    const owner = this.conversationOwner();
    const skillCursor = this.continuityCursorOf(state);
    return {
      version: 1,
      runId: this.currentRunContext.runId,
      history,
      lastCompletedIteration: typeof state?.iteration === 'number' ? state.iteration : 0,
      originalInput: { message: typeof state?.userMessage === 'string' ? state.userMessage : '' },
      checkpointedAt: Date.now(),
      // Absent when nothing ever folded — a key that is always there and
      // usually empty reads like "no folds were retained", which is a
      // different claim from "there were no folds".
      ...(folded !== undefined && { folded }),
      // Who it was for and who ran it (9.2.0) — both absent unless chosen.
      ...(owner.identity !== undefined && { identity: owner.identity }),
      ...(owner.agentId !== undefined && { agent: { id: owner.agentId } }),
      // Where the graph stood (SG-C) — written ONLY under
      // `continuity: 'conversation'`, so every other checkpoint keeps its
      // exact byte shape.
      ...(skillCursor !== undefined && { skillCursor }),
    };
  }

  /**
   * The graph cursor a conversation carrier stores — the run's final
   * committed `currentSkillId`, read from the SNAPSHOT (the state the run
   * actually committed; both chart shapes map the advanced cursor onto it
   * every iteration), and only when the mounted graph declared
   * `continuity: 'conversation'`.
   *
   * ONE reader for BOTH carriers — `checkpoint()` (the conversation door
   * `followUp()` walks through) and the crash checkpoint
   * `RunCheckpointError` carries — the `foldedSpansOf`/`conversationOwner`
   * rule: a conversation must not keep its place on one path and silently
   * lose it on the other.
   *
   * @internal
   */
  private continuityCursorOf(state?: Partial<AgentState>): string | undefined {
    if (this.skillGraphCascade?.continuity !== 'conversation') return undefined;
    const cursor = state?.currentSkillId;
    return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined;
  }

  /**
   * The folded spans this run has committed, cloned on the way out.
   *
   * One reader for both carriers — `checkpoint()` and the crash checkpoint
   * `RunCheckpointError` carries — so a conversation cannot keep its spans on
   * one path and silently lose them on the other. The clone is the same
   * promise `checkpoint()` makes about history: a persistence layer never gets
   * a reference into the live heap.
   *
   * @internal
   */
  private foldedSpansOf(state?: Partial<AgentState>): readonly FoldedSpan[] | undefined {
    const spans = state?.foldedSpans;
    if (spans === undefined || spans.length === 0) return undefined;
    return structuredClone(spans) as readonly FoldedSpan[];
  }

  /**
   * The two owner facts every conversation carrier stamps — who the run was
   * for, and which agent ran it (9.2.0).
   *
   * One reader for `checkpoint()` and the crash checkpoint, the same rule
   * `foldedSpansOf` follows: a fact kept on one carrier and lost on the other
   * is worse than a fact kept on neither. Both are absent unless the caller
   * chose them, which is what keeps the fingerprint refusal narrow and the
   * default `conversationId` out of storage.
   *
   * @internal
   */
  private conversationOwner(): { identity?: MemoryIdentity; agentId?: string } {
    return {
      ...(this.lastRunIdentity !== undefined && { identity: this.lastRunIdentity }),
      ...(this.explicitId !== undefined && { agentId: this.explicitId }),
    };
  }

  /**
   * Restore a stored conversation onto the side channel `seed` reads.
   *
   * THE one restoration path — `run({ continueFrom })` and `resumeOnError()`
   * both come through here, so the conversation door and the error door cannot
   * disagree about what continuing means. It checks the agent fingerprint,
   * restores history + folded spans, and adopts the conversation's identity so
   * the continued turn writes its memory where the earlier turns are.
   *
   * `appendMessage` is the difference between the two callers, and it is the
   * whole difference. Continuing a conversation ADDS this turn's user message
   * to the stored history; resuming after an error does NOT, because there the
   * message is already the last user turn in that history and appending it
   * would ask the same question twice.
   *
   * @internal
   */
  private applyContinuation(cp: AgentRunCheckpoint, door: string, appendMessage?: string): void {
    assertContinuable(cp, this.explicitId, door);
    const history = cp.history as readonly LLMMessage[];
    this.pendingResumeHistory =
      appendMessage === undefined
        ? history
        : [...history, { role: 'user', content: appendMessage }];
    // The folded spans beside it. A conversation stored before 8.2 has none,
    // and `undefined` is the right answer there — it means "this conversation
    // recorded no folds", which is exactly true.
    this.pendingResumeFolded = cp.folded;
    // The conversation's skill cursor (SG-C). Stashed unconditionally —
    // whether it is HONORED is seed's `restoreSkillCursor` gate, which reads
    // the mounted graph's `continuity` declaration; a checkpoint written by a
    // continuity graph and continued on a `'turn'` one is consumed and
    // ignored, exactly like a `folded` field on an agent that never folds.
    this.pendingResumeSkillCursor = cp.skillCursor;
  }

  /** One turn at a time — see `RunInFlightError`. @internal */
  private assertNotRunning(door: string): void {
    if (this.inFlightRunId !== undefined) {
      throw new RunInFlightError(door, this.id, this.inFlightRunId);
    }
  }

  /** A person's unanswered question outranks a new message — see
   *  `PendingQuestionError`. @internal */
  private assertNoPendingQuestion(door: string): void {
    if (this.pendingQuestion !== undefined) {
      throw new PendingQuestionError(door, this.pendingQuestion);
    }
  }

  /**
   * Remember (or forget) the question this run ended on.
   *
   * A paused outcome sets it; anything else clears it, because a run that
   * reached an answer has no outstanding question by definition. Reads the
   * same `pauseData` fields `standingAgent.describePause` reads — the tool
   * name and question the dispatch loop stamped — and invents nothing.
   *
   * @internal
   */
  private recordPendingQuestion(outcome: AgentOutput | RunnerPauseOutcome): void {
    if (typeof outcome === 'string') {
      this.pendingQuestion = undefined;
      return;
    }
    const data = outcome.pauseData as
      | { toolName?: unknown; toolCallId?: unknown; question?: unknown }
      | undefined;
    this.pendingQuestion = {
      ...(typeof data?.toolName === 'string' && { toolName: data.toolName }),
      ...(typeof data?.toolCallId === 'string' && { toolCallId: data.toolCallId }),
      ...(typeof data?.question === 'string' && { question: data.question }),
    };
  }

  /**
   * Hand the `.selfExplain()` binding to the agent that owns it.
   *
   * Called once by `AgentBuilder.build()`, immediately after `bindTo`. The
   * binding stays the tool provider's to read; the Agent holds it only so
   * `canExplain()` answers from the same fact the trace tools answer from,
   * rather than from a second guess about whether a run has completed.
   *
   * @internal
   */
  bindSelfExplain(binding: SelfExplainBinding): void {
    this.selfExplainBinding = binding;
  }

  /**
   * Refuse, at run start, any declared messages-slot role this provider
   * cannot carry inside its message list (7.21, D2).
   *
   * Run start rather than build time because the answer depends on the
   * provider — and a decorated provider (`withFallback`, `withRetry`) is only
   * the thing it is once composed. Run start rather than delivery time
   * because a declaration that can never work should fail on the first call,
   * not three iterations into a paid run. The delivery stage re-checks each
   * message anyway, which is what catches roles that only exist at run time
   * (a hand-built memory-recall subflow's formatted output).
   *
   * Called from the ONE place `run()` and `resume()` share, so no entry point
   * can slip past it.
   */
  /**
   * The OPEN skills — the ones `read_skill` may reach from anywhere, whatever the
   * graph's cursor says (8.4.0). Two clauses, both load-bearing:
   *
   *   • `trigger.kind === 'llm-activated'` — the trigger that reads
   *     `activatedInjectionIds`, which is the ONLY thing a `read_skill` call writes.
   *     It is exactly "read_skill can really activate this", so admitting anything
   *     else (a hand-built `rule` injection, say) would replace one lie with another:
   *     the tool would answer "activated" and nothing would activate.
   *   • the graph declares no incoming edge to it — a bare model edge `.route(a, m)`
   *     is a declared, drawn, `from`-gated affordance ("from a, the model may hop to
   *     m"), and opening every such target would silently globalize it. What is left
   *     is skills the graph never mentions at all.
   *
   * That covers three shapes that were all dead before: `.selfExplain()`'s debug
   * skill under a graph, a `.skill()`/`.skills()` registration beside a graph, and a
   * skill listed in `skills[]` and wired to nothing (whose own check-up warning says
   * "it can only be reached by the model via read_skill" — true again now).
   *
   * An open pick ACTIVATES but never moves the cursor — see the tool-calls gate.
   * Computed once per chart build; the injection list is fixed at construction.
   */
  /**
   * The identity facts this run hands `tool.execute` (9.7.0).
   *
   * Read through an ACCESSOR from the chart (see `ToolCallsHandlerDeps.currentRun`)
   * because the chart is built once and this changes every run.
   *
   * `identity` is `lastRunIdentity` — what the CALLER passed — and deliberately
   * NOT `scope.runIdentity`, which is always populated and defaults to
   * `{ conversationId: '<runId>' }` (or, on a session-bound run since 9.10.0,
   * to `{ conversationId: sessionId }`). Handing a tool a synthesized
   * conversation as "the identity" would let it key an isolated session on a
   * fiction, and would make "absent" unrepresentable at exactly the layer that
   * most needs to see it. The session-derived namespace is synthesized too, and
   * is withheld here for that reason — `sessionId` beside it is the fact the
   * transport really delivered.
   */
  private toolRunFacts(): {
    readonly runId: string;
    readonly sessionId?: string;
    readonly identity?: MemoryIdentity;
  } {
    return {
      runId: this.currentRunContext.runId,
      ...(this.currentRunContext.sessionId !== undefined && {
        sessionId: this.currentRunContext.sessionId,
      }),
      ...(this.lastRunIdentity !== undefined && { identity: this.lastRunIdentity }),
    };
  }

  /**
   * The teardown tier, built on FIRST registration.
   *
   * An agent whose tools never hold a session never allocates one, and its
   * terminals stay a single `undefined` check.
   */
  private toolSessions(): ToolSessionTier {
    if (!this.toolSessionTier) {
      this.toolSessionTier = new ToolSessionTier({
        timeoutMs: this.toolTeardownTimeoutMs,
        report: (report) => this.emitToolSessionReport(report),
      });
    }
    return this.toolSessionTier;
  }

  /**
   * Turn one TEARDOWN report into a typed `agentfootprint.tools.session_*` event.
   *
   * Only the two closing events come through here. A start and a reuse happen
   * inside `tool.execute`, where the dispatch loop still holds the scope, so
   * those ride the ordinary emit channel and carry the stage they really
   * happened in. These two fire after the run's last stage committed, and this
   * is the one place that has to answer "from where?" without a stage to point
   * at.
   *
   * **Built with `buildEventMeta`, never `minimalMeta()`.** `minimalMeta()`
   * hardcodes `runId: 'consumer-scope'`, and a teardown event stamped that way
   * cannot be joined to the run that OPENED the session — the exact
   * unjoinability 9.4.0 spent a release fixing for credential events. So the
   * meta comes from `currentRunContext`, with a STATED pseudo-stage, the same
   * move as the `'<stageId>#paused'` stamp at the pause boundary.
   */
  private emitToolSessionReport(report: ToolSessionReport): void {
    const type =
      report.kind === 'closed'
        ? 'agentfootprint.tools.session_closed'
        : 'agentfootprint.tools.session_close_failed';
    const dispatcher = this.getDispatcher();
    if (!dispatcher.hasListenersFor(type)) return;
    const { kind: _kind, ...payload } = report;
    dispatcher.dispatch({
      type,
      payload,
      meta: buildEventMeta({ runtimeStageId: TOOL_TEARDOWN_STAGE_ID }, this.currentRunContext),
    } as unknown as AgentfootprintEventMap[typeof type]);
  }

  private openSkillIds(): readonly string[] {
    return this.injections
      .filter(
        (i) =>
          i.flavor === 'skill' &&
          i.trigger.kind === 'llm-activated' &&
          !this.skillGraphEdgeTargets.has(i.id),
      )
      .map((i) => i.id);
  }

  /**
   * The per-iteration `read_skill` offer builder — or `undefined` to leave the tool
   * exactly as it has always been (8.5.0).
   *
   * `read_skill` enumerated every registered skill while the gate admitted only
   * `reachableSkills(cursor) ∪ open`, so under a graph the model was handed ids it
   * would be refused, every iteration, and could spend a whole run re-asking. The
   * OFFER is rebuilt here from the same two functions the gate itself calls — one
   * source of truth, so the menu cannot drift from the verdict.
   *
   * Two guards:
   *
   *   • no graph AND no per-role skill visibility → `undefined`. A plain
   *     `read_skill` agent has no cursor and no gate; every registered skill
   *     really is reachable, and the tool keeps its byte-identical description.
   *   • `reactMode: 'classic'` → `undefined` for the GRAPH menu, plus a dev-mode
   *     warning. Classic composes the tools slot on turn 1 ONLY (see the Context
   *     selector's `includeStatic`), so a cursor-scoped menu would freeze at the
   *     cold-start cursor and keep advertising it for the rest of the run — a
   *     worse lie than the honest full catalog. `.selfExplain()` refuses under
   *     classic for exactly this caching reason; here the full catalog is a
   *     correct fallback, so this warns instead of refusing.
   *
   * Per-role VISIBILITY (9.11.0) survives classic, and that is not an
   * inconsistency: a cursor moves every iteration, but who is asking does not
   * change inside one run. A filter computed on turn 1 is still exactly right
   * on turn 9.
   */
  private readSkillOfferFor():
    | ((args: {
        readonly currentSkillId?: string;
        readonly hiddenSkillIds?: readonly string[];
        readonly menu?: {
          readonly candidates: ReadonlyArray<{ readonly id: string; readonly relevance?: number }>;
          readonly cursorId?: string;
          readonly stay?: boolean;
        };
      }) => LLMToolSchema)
    | undefined {
    const skills = this.injections.filter((i) => i.flavor === 'skill');
    if (skills.length === 0) return undefined;
    const filtersByRole = this.governsSkillVisibility();
    if (!this.skillGraphReachable && !filtersByRole) return undefined;
    let graphMenu = this.skillGraphReachable;
    if (graphMenu && this.reactMode === 'classic') {
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          "agentfootprint Agent: read_skill's menu is built at turn 1 under " +
            "reactMode: 'classic', which caches the tools slot — so it lists every " +
            'registered skill instead of the ones reachable from the cursor, and the ' +
            "model will be offered ids the graph will refuse. Use the default 'dynamic' " +
            "mode (or 'dynamic-grouped') for a cursor-tracking menu.",
        );
      }
      graphMenu = undefined;
      if (!filtersByRole) return undefined;
    }
    const open = this.openSkillIds();
    const reachable = graphMenu;
    return (args) => {
      const grantable = reachable
        ? [...new Set([...reachable(args.currentSkillId), ...open])]
        : undefined;
      // Non-null: `skills` is non-empty, so the builder always returns a tool.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return buildReadSkillTool(skills, {
        ...(grantable !== undefined && { grantable }),
        ...(args.hiddenSkillIds !== undefined && { hiddenIds: args.hiddenSkillIds }),
        // WHERE THE MODEL STANDS (9.84.0) — unconditional, unlike the menu below.
        // The description names it, and stops listing it as unreachable.
        ...(args.currentSkillId !== undefined && { cursorId: args.currentSkillId }),
        // The turn-start menu (SG-C) — the tools slot passes it only while the
        // verdict is outstanding; describeOffer leads with it.
        ...(args.menu !== undefined && { menu: args.menu }),
      })!.schema;
    };
  }

  /**
   * Does the configured checker ask to decide which skills this caller sees?
   * (9.11.0)
   *
   * Absence is NO — see `PermissionChecker.governs`. This is the ONE switch:
   * false and the menu, the resolver and the activation gate are all inert, so
   * an agent with a checker that predates 9.11.0 composes the same prompt it
   * always did.
   */
  private governsSkillVisibility(): boolean {
    return checkerGoverns(this.permissionChecker, 'skill_read');
  }

  /**
   * Which skills the caller's role may NOT see, asked once per iteration
   * (9.11.0).
   *
   * Per iteration rather than per run because the checker is a port: a
   * hub-backed one can legitimately answer differently as a grant is revoked
   * mid-conversation, and caching the first answer would keep a withdrawn skill
   * on the menu for the rest of the run. The cost is one `check()` per skill per
   * iteration, paid only by agents that opted in.
   *
   * A skill is hidden when the checker returns anything other than `'allow'` /
   * `'gate_open'` — and when the checker THROWS, which is the fail-closed half:
   * a policy that did not answer did not say yes, and the same sentence governs
   * the tool gate.
   */
  private hiddenSkillIdsNow(): (() => Promise<readonly string[]>) | undefined {
    if (!this.governsSkillVisibility()) return undefined;
    const checker = this.permissionChecker;
    const skillIds = this.injections.filter((i) => i.flavor === 'skill').map((i) => i.id);
    if (!checker || skillIds.length === 0) return undefined;
    return async (): Promise<readonly string[]> => {
      const identity = this.lastRunIdentity;
      const hidden: string[] = [];
      for (const id of skillIds) {
        let allowed = false;
        try {
          const decision = await checker.check({
            capability: 'skill_read',
            actor: 'agent',
            target: skillTarget(id),
            ...(identity !== undefined && { identity }),
          });
          allowed = decision.result === 'allow' || decision.result === 'gate_open';
        } catch {
          // Fail closed. The refusal the model would read is the dispatch
          // gate's job; here the only decision is whether to advertise a skill
          // whose policy is unreachable, and advertising it would be a menu
          // built on a question nobody answered.
          allowed = false;
        }
        if (!allowed) hidden.push(id);
      }
      return hidden;
    };
  }

  private assertDeliverableRoles(): void {
    const carries = carriedRoles(this.provider);
    const carried = new Set(carries);
    for (const inj of this.injections) {
      for (const msg of inj.inject?.messages ?? []) {
        if (!carried.has(msg.role as (typeof carries)[number])) {
          throw new Error(
            messagesRoleRefusal({
              site: `Agent injection '${inj.id}'`,
              role: msg.role,
              providerName: this.provider.name,
              carries,
            }),
          );
        }
        // Content, judged at the same funnel as role (8.18.0). The named
        // factories refuse empty content; a hand-built Injection reached the
        // delivery stage unchecked and put a contentless turn on the wire.
        const content = msg.content as unknown;
        if (typeof content !== 'string' || content.trim() === '') {
          throw new Error(
            messagesContentRefusal({
              site: `Agent injection '${inj.id}'`,
              role: msg.role,
              received:
                typeof content !== 'string'
                  ? content === undefined
                    ? 'missing'
                    : `a ${content === null ? 'null' : typeof content}`
                  : 'empty',
            }),
          );
        }
      }
    }
  }

  /**
   * Refuse, at run start, a `'tool-forced'` output strategy on a provider
   * that does not put a forced tool choice on its wire (7.26).
   *
   * Run start rather than build time for the reason `assertDeliverableRoles`
   * gives one method up: a decorated provider (`withFallback`, `withRetry`,
   * a breaker) is only the thing it is once composed, and `withFallback`
   * publishes the AND of its pair.
   *
   * Refusal rather than a quiet fall back to `'instruct'`, because the two
   * are not interchangeable: one constrains the shape at generation, the
   * other asks for it in prose. An agent that silently got the second while
   * its config said the first would be a promise the recording could not
   * even show was broken.
   */
  private assertForcedToolChoiceSupported(): void {
    if (this.outputEnforcement?.schemaTool === undefined) return;
    if (this.provider.carriesForcedToolChoice === true) return;
    throw new Error(
      `Agent: .outputSchema(parser, { strategy: 'tool-forced' }) needs a provider that puts ` +
        `a forced tool choice on its wire, and '${this.provider.name}' does not declare one. ` +
        `Anthropic, Bedrock, real OpenAI/Azure and the mock do; an OpenAI-COMPATIBLE endpoint ` +
        `behind a custom baseURL (Ollama, vLLM, …) deliberately does not, because what that ` +
        `server does with tool_choice is not this library's to promise. Use ` +
        `{ strategy: 'instruct', retries: N } on this provider — it works on every wire — or ` +
        `run the forced strategy on a provider that declares the capability.`,
    );
  }

  private createExecutor(runOptions?: AgentRunOptions): FlowChartExecutor {
    this.assertDeliverableRoles();
    this.assertForcedToolChoiceSupported();
    const correlationId = runOptions?.correlationId;
    const traceId = runOptions?.traceId ?? runOptions?.env?.traceId;
    const sessionId = runOptions?.sessionId;
    // The actor, for every event this run emits (9.11.0).
    //
    // `lastRunIdentity` is what the CALLER passed and nothing else — `run()`
    // sets it from `input.identity ?? options.identity ?? the conversation's`
    // before this method is reached, and it stays undefined when nobody named
    // one. `resume()` does not set it, so an explicit identity handed to
    // `resume(cp, input, { identity })` is honoured here and a bare resume
    // inherits whatever the run it continues was for.
    //
    // NOT `scope.runIdentity`: that one is always populated and defaults to
    // `{ conversationId: '<runId>' }` (or, since 9.10.0, to the sessionId on a
    // session-bound run). Stamping either as the principal would publish a
    // synthesized conversation as an actor — and a caller-supplied session id
    // is exactly the string an auditor must not read as "who did this".
    // `conversationId` is deliberately not carried: it is a thread, not a
    // person, and `sessionId` beside it is the fact the transport delivered.
    const actor = runOptions?.identity ?? this.lastRunIdentity;
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Agent:${this.id}`],
      ...(correlationId !== undefined && { correlationId }),
      ...(traceId !== undefined && { traceId }),
      // Session identity rides beside runId, not instead of it: one session
      // produces many runs, and an event needs to say which of each it is.
      ...(sessionId !== undefined && { sessionId }),
      ...(actor?.principal !== undefined && { principal: actor.principal }),
      ...(actor?.tenant !== undefined && { tenant: actor.tenant }),
    };

    // Reuse the cached chart built at constructor time.
    // The Agent's executor dials: readTracking (#18/#14, snapshot stageReads),
    // commitValues (#13c-B, commit-log value encoding) and writeProvenance
    // (#P1, per-write read provenance — the exact-dataflow debugging dial).
    const executor = new FlowChartExecutor(this.getSpec(), {
      readTracking: this.readTracking,
      commitValues: this.commitValues,
      writeProvenance: this.writeProvenance,
    });
    // Enable structured narrative so `getLastNarrativeEntries()` can
    // hand a populated array to consumer Trace views (ExplainableShell).
    // Cheap when no consumer reads it; the recorder accumulates only.
    executor.enableNarrative();
    this.lastExecutor = executor;

    const dispatcher = this.getDispatcher();
    const getRunCtx = (): RunContext => this.currentRunContext;

    // RFC-001 Block 10 — observer delivery tier. With 'deferred', every
    // bridge below is attached onto footprintjs's bounded capture queue
    // ("one beat behind": capture inline ≈ microseconds, delivery at the
    // next microtask checkpoint, terminal flush before run()/resume()
    // returns). Default 'inline' attaches with no options bag —
    // byte-identical to every prior release.
    const deferredOpts: AttachRecorderOptions | undefined =
      this.observerDelivery === 'deferred'
        ? { delivery: 'deferred', ...this.observerDeliveryOptions }
        : undefined;
    const attachObserver = (rec: CombinedRecorder): void => {
      if (deferredOpts) executor.attachCombinedRecorder(rec, deferredOpts);
      else executor.attachCombinedRecorder(rec);
    };

    attachObserver(new ContextRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Evidence bridge (#5): harvest decisions/toolCalls/tokens for causal snapshots.
    // ALWAYS INLINE — never routed through the deferred queue: the memory
    // write stage consumes its accumulators MID-run (`collect()` via
    // `evidenceSource`, mountMemoryPipeline). Deferred delivery would run
    // `collect()` before the queue flushed the turn's tool/token/decision
    // events, persisting an incomplete causal snapshot.
    if (this.causalEvidence) executor.attachCombinedRecorder(this.causalEvidence);
    // Compaction's instrument. ALWAYS INLINE, for the same reason the evidence
    // bridge is: the compaction stage reads it MID-run, at the loop head, to
    // decide whether this iteration's window is over budget. A measurement
    // delivered one beat behind would be a measurement of the wrong window.
    if (this.compactionMeterHandle) {
      executor.attachCombinedRecorder(this.compactionMeterHandle);
      // Folds speak the context vocabulary consumers already subscribe to
      // (`context.evicted` / `context.budget_pressure`) — no new event types.
      // ContextRecorder only dispatches those from writes INSIDE a slot
      // subflow, and the compaction stage is not one, so it emits them and
      // this bridge forwards them (the `contextEvaluatedRecorder` pattern).
      attachObserver(
        new EmitBridge({
          dispatcher,
          id: 'af-compaction-events',
          prefix: ['agentfootprint.context.evicted', 'agentfootprint.context.budget_pressure'],
          getRunContext: getRunCtx,
        }),
      );
    }
    // The InjectionEngine typedEmits context.evaluated; this bridge forwards it
    // to the dispatcher (ContextRecorder handles the write-derived context.*).
    attachObserver(contextEvaluatedRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(streamRecorder({ dispatcher, getRunContext: getRunCtx }));
    // agentRecorder feeds the run-checkpoint tracker (iteration_end →
    // history snapshot), which is read ONLY in run()'s catch — after the
    // engine's terminal flush at the reject boundary — so deferral is safe
    // (pinned by test: crash checkpoints stay complete under 'deferred').
    attachObserver(agentRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Terminal-failure bridge: footprintjs onRunFailed → typed error.fatal,
    // so a thrown run clears in-flight live state + flips monitor status.
    // Deferral-safe: the reject-boundary terminal flush delivers error.fatal
    // before the rejection reaches the caller.
    attachObserver(errorBridge({ dispatcher, getRunContext: getRunCtx }));
    // The cost bridge is ALWAYS attached since 8.14.0. It used to be gated on
    // `pricingTable`, which was right while `cost.*` only ever meant money:
    // `emitCostTick` returns on its first line without a table, so the gate
    // could not hide anything. `cost.limit_hit { kind: 'max_iterations' }`
    // broke that assumption — an iteration limit has no price and fires on any
    // agent, and behind the old gate it would have reached the dispatcher only
    // for agents that happened to be costing themselves. The bridge drops
    // events with no listener, so an agent that subscribes to nothing pays
    // nothing for it.
    attachObserver(costRecorder({ dispatcher, getRunContext: getRunCtx }));
    if (this.permissionChecker) {
      attachObserver(permissionRecorder({ dispatcher, getRunContext: getRunCtx }));
    }
    // Always-on bridges for consumer-emitted domain events.
    attachObserver(evalRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(memoryRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Embedding cost telemetry (8.9.0). The domain had a payload, a registry
    // entry and a DomainWildcard arm since 2.x and NO bridge, so the event
    // could not have arrived however correctly it was fired. Zero-cost when
    // the agent embeds nothing.
    attachObserver(embeddingRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(skillRecorder({ dispatcher, getRunContext: getRunCtx }));
    attachObserver(toolsRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Tool-args validation events (#9) — always-on; zero-cost when no
    // validation event fires.
    attachObserver(validationRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Credential lifecycle (9.4.0). The domain has emitted since 6.11.0 with no
    // bridge, so `agent.on('agentfootprint.credential.failed', …)` observed
    // nothing however correctly the event fired — which is how an identity
    // adapter that failed every call did so in a silence that read like health.
    // Always-on and zero-cost: the bridge drops an event nobody listens for.
    attachObserver(credentialRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Map engagement (9.58.0). Shipped WITH the domain, same lesson as above.
    attachObserver(mapRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Context Integrity findings (9.60.0). Same lesson, applied again.
    attachObserver(integrityRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Artifact lifecycle (9.21.0). Shipped WITH the domain — the credential
    // bridge above is the record of what waiting costs. Always-on and
    // zero-cost: with no store attached nothing emits, and the bridge drops
    // an event nobody listens for.
    attachObserver(artifactsRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Reliability telemetry (rules-loop fail_fast / retried / recovered).
    // Always-on, but zero-cost when no .reliability() config fires events.
    attachObserver(reliabilityRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Provider-decorator telemetry (withFallback / withRetry reports,
    // translated in-run by `resilienceHooks`). Always-on, but zero-cost
    // when the configured provider is undecorated or never fails. Also
    // covers a `.reliability()` run: that path is `executeWithReliability`
    // driving `singleProviderCall` inside the SAME call-llm stage
    // (callLLM.ts), so the decorator's reports ride this bridge too. (It
    // is NOT the `buildReliabilityGateChart` subflow — the Agent never
    // mounts that chart; nothing shipped does.)
    attachObserver(resilienceRecorder({ dispatcher, getRunContext: getRunCtx }));
    // Check-in events bridge (evidence-carrying human consent). Always-on;
    // forwards checkin.request/decision $emits to the dispatcher so
    // `agent.on('agentfootprint.checkin.*')` fires. Zero-cost until a tool with
    // `checkIn` trips.
    attachObserver(checkInEventsBridge({ dispatcher, getRunContext: getRunCtx }));
    // Same wiring for `agentfootprint.middleware.*` — the governance chains'
    // one event. Attached only when a chain exists: an agent without middleware
    // gains no bridge, no listener and no per-event work.
    if (this.toolMiddleware.length > 0 || this.messageMiddleware.length > 0) {
      attachObserver(
        new EmitBridge({
          id: 'agentfootprint.middleware-bridge',
          prefix: 'agentfootprint.middleware.',
          dispatcher,
          getRunContext: getRunCtx,
        }),
      );
    }
    for (const r of this.attachedRecorders) {
      // A recorder's OWN `delivery` field is more specific than the
      // agent-level default — footprintjs's options bag would override the
      // field, so recorders that declare a tier are attached bare (their
      // field rules). This gives consumers a per-recorder escape hatch:
      // `{ id, delivery: 'inline', ...hooks }` stays inline under an
      // observerDelivery: 'deferred' agent, and vice versa.
      if (r.delivery !== undefined) executor.attachCombinedRecorder(r);
      else attachObserver(r);
    }
    // LAST, so the manifest describes a fully-wired run — and so it is the
    // first event of this runId that any listener sees.
    this.emitRunManifest();
    // …then the declared skill map (9.50.0), so a recording opens with the
    // arm's configuration and the author's topology before any stage event.
    this.emitSkillGraphDeclared();
    return executor;
  }

  /**
   * File the run-configuration manifest (9.41.0) — which adapters and
   * strategies this run is about to use, stamped with the runId every other
   * event of the run already carries.
   *
   * **Why it lives in `createExecutor` and not in `run()`.** `run()` and
   * `resume()` both come through here, and both mint a fresh runId (a resumed
   * run is a new run to every consumer joining on `meta.runId`, so a resume
   * with no manifest would be a run whose arm nobody can name). One funnel is
   * also how the next entry point cannot forget — the `beginIngress` lesson.
   *
   * **Why a direct dispatch rather than `typedEmit`.** There is no stage: the
   * chart has not started. So it is built with `buildEventMeta` and a STATED
   * pseudo-stage, exactly like the tool-teardown reports at the other end of
   * the run — never `minimalMeta()`, whose hardcoded `runId: 'consumer-scope'`
   * would make the one event whose whole job is to BE joinable the one event
   * that cannot be joined.
   *
   * **Why it is gated on a listener.** Every typed event in this library is:
   * the dispatcher drops what nobody subscribed to, and `EmitBridge` does the
   * same upstream. The gate is what keeps an unwatched agent at one map
   * lookup per run. It also means the manifest is not "always on" but "always
   * there when anything is watching" — including `recordRun`, which subscribes
   * with `'*'` before the run starts, so every recording carries one.
   */
  /** Fresh per-run ledger — see AgentOptions.integrityPosture (9.60.0). */
  private beginIntegrityLedger(): void {
    this.integrityLedgerHolder.current = beginIntegrityRun(
      {
        wire: true,
        composeInvariant: this.mapsPlan !== undefined,
        dangling: this.integrityDanglingPresent,
        claim: this.claimContract !== undefined,
        // TWO HALVES (9.77.0): the operator's dial AND a declaration to arm
        // on. Either alone leaves a registered `not-applicable` row.
        emptyLookup: this.noticeEmptyLookups && this.integrityDanglingPresent,
        // TWO HALVES (9.78.0), the same law: the operator's dial off `'off'`
        // AND a tool declaring `resultColumns`. Either alone leaves two
        // registered `not-applicable` rows.
        columnTypes: this.checkColumnTypes !== 'off' && this.integrityColumnsPresent,
        // TWO HALVES (9.83.0), and here the second is structural rather than
        // a policy choice: the evidence gate owns the extractor that decides
        // which tokens in an answer are values, so a dial with no gate has
        // nothing whose provenance it could read. Either alone leaves a
        // registered `not-applicable` row.
        priorTurnEvidence: this.noticePriorTurnEvidence && this.evidenceGate !== undefined,
      },
      this.integrityPosture,
    );
  }

  /**
   * Dev posture only: throw {@link CheckerDeadError} on a run whose
   * registered checkers demonstrably never ran, or whose canary went
   * uncaught. Called on the SUCCESS path before the recording files, so the
   * failure is the run's result, never a masked afterthought.
   */
  private assertIntegrityAlive(): void {
    if (this.integrityPosture !== 'dev') return;
    this.integrityLedgerHolder.current?.assertAlive({
      workExisted: this.integrityWorkExisted(),
    });
  }

  /**
   * Did this run reach work a registered check should have seen?
   *
   * MEASURED, not asserted — and measured from a signal the integrity code
   * does not write. `llmLatestContent` is committed by the LLM stage's own
   * core path on every completed call, so its presence proves a call
   * happened; its absence proves the run died or paused before one, and a
   * checker that filed nothing THERE is not rot, it is a run that never got
   * started. Deriving this from the checks' own encounter counts would be
   * circular: an unhooked check would report "no work existed" and silence
   * the very alarm it should be tripping.
   */
  private integrityWorkExisted(): boolean {
    const state = this.getLastSnapshot()?.sharedState as { llmLatestContent?: unknown } | undefined;
    return state !== undefined && state.llmLatestContent !== undefined;
  }

  /**
   * File the run's disposition rows as ONE `integrity.disposition` event and
   * clear the ledger. On the finally path of both run doors — every exit,
   * before the recording stops. Listener-gated like every typed event, and
   * deliberately throw-proof: accounting must never change a run's outcome.
   */
  private fileIntegrityDisposition(): void {
    const ledger = this.integrityLedgerHolder.current;
    this.integrityLedgerHolder.current = undefined;
    if (ledger === undefined) return;
    try {
      const type = 'agentfootprint.integrity.disposition';
      const dispatcher = this.getDispatcher();
      if (!dispatcher.hasListenersFor(type)) return;
      dispatcher.dispatch({
        type,
        payload: {
          posture: this.integrityPosture,
          workExisted: this.integrityWorkExisted(),
          rows: ledger.report(),
        },
        meta: buildEventMeta(
          { runtimeStageId: INTEGRITY_DISPOSITION_STAGE_ID },
          this.currentRunContext,
        ),
      });
    } catch {
      // Recorder/dispatcher failures never abort a run — the house rule.
    }
  }

  private emitRunManifest(): void {
    const type = 'agentfootprint.agent.run_configured';
    const dispatcher = this.getDispatcher();
    if (!dispatcher.hasListenersFor(type)) return;
    dispatcher.dispatch({
      type,
      payload: buildRunManifest({
        agentId: this.id,
        providerName: this.provider.name,
        model: this.model,
        hasRunConfig: this.runConfigFn !== undefined,
        hasSkillBrains: this.skillBrains !== undefined,
        reactMode: this.reactMode,
        memories: this.memories,
        ...(this.windowStrategy !== undefined && {
          windowStrategyName: this.windowStrategy.name,
        }),
        // A graph is mounted iff `.skillGraph()` handed over its cursor
        // resolver. NOT `skillGraphCascade`, which a graph mounted without the
        // turn-start cascade options never sets — reading that one would
        // report "no graph" for a graph that routes every turn.
        ...(this.skillGraphNextSkill !== undefined && {
          skillGraph: {
            ...(this.skillGraphCascade !== undefined && {
              routing: this.skillGraphCascade.strictness,
              continuity: this.skillGraphCascade.continuity,
            }),
            ...(this.skillGraphCascade?.turnRouting?.scorer !== undefined && {
              scorerName: this.skillGraphCascade.turnRouting.scorer.name,
            }),
          },
        }),
        ...(this.evidenceGate !== undefined && {
          evidenceGatePosture: this.evidenceGate.posture,
        }),
        // The compositions this agent was built from, in declaration order.
        // Spread value-conditionally so an agent with none passes no key at all
        // — see `RunManifestSources.recipes` for why it is absent rather than
        // an empty list.
        ...(this.appliedRecipes !== undefined && { recipes: this.appliedRecipes }),
        // The store itself is never named — see RunManifestSources.artifacts.
        ...(this.artifactStore !== undefined && {
          artifacts: {
            configured: true as const,
            placement: this.artifactPlacement !== undefined,
            recordings: this.artifactRecordings !== undefined,
          },
        }),
      }),
      meta: buildEventMeta({ runtimeStageId: RUN_MANIFEST_STAGE_ID }, this.currentRunContext),
    });
  }

  /**
   * File the DECLARED skill map (9.50.0) — `agentfootprint.skill.graph_declared`,
   * once per run, right after the run-configuration manifest.
   *
   * Same funnel, same dispatch discipline, same listener gate as the manifest
   * (see `emitRunManifest` above): `run()` and `resume()` both come through
   * `createExecutor`, both mint a fresh runId, and a resumed run's consumers
   * deserve the topology under the runId they are joining on. The payload is
   * the map `AgentBuilder.skillGraph()` projected at mount — the author's
   * nodes and edges VERBATIM, never inferred from runtime hops — so a
   * recording carries the complete declared topology rather than the
   * fired-edges lower bound that `context.evaluated.routing[]` names.
   *
   * No graph, or a graph that could not state its map ⇒ no event — absent,
   * never guessed.
   */
  private emitSkillGraphDeclared(): void {
    if (this.skillGraphDeclared === undefined) return;
    const type = 'agentfootprint.skill.graph_declared';
    const dispatcher = this.getDispatcher();
    if (!dispatcher.hasListenersFor(type)) return;
    dispatcher.dispatch({
      type,
      payload: this.skillGraphDeclared,
      meta: buildEventMeta({ runtimeStageId: GRAPH_DECLARED_STAGE_ID }, this.currentRunContext),
    });
  }

  /**
   * Flush the deferred-observer backlog of the most recent run's executor,
   * then await async listener completions under a deadline (RFC-001 §11 —
   * the serverless / graceful-shutdown pattern). Resolves immediately with
   * zeros before the first run or when `observerDelivery` is `'inline'`
   * and no recorder opted into `'deferred'` itself.
   *
   * `pending === 0` means a full drain; non-zero honestly reports
   * continuations still outstanding at the deadline — never silent loss.
   *
   * @example Lambda-style handler
   * ```ts
   * export const handler = async (event) => {
   *   const reply = await agent.run({ message: event.message });
   *   // settle "one beat behind" observer work BEFORE the freeze:
   *   await agent.drainObservers({ timeoutMs: 5_000 });
   *   return reply;
   * };
   * ```
   */
  drainObservers(opts?: { timeoutMs?: number }): Promise<ObserverDrainResult> {
    if (!this.lastExecutor) return Promise.resolve({ done: 0, failed: 0, pending: 0 });
    return this.lastExecutor.drainObservers(opts);
  }

  /**
   * Did the last turn stop because a LIMIT cut it short — and if so, which?
   *
   * `undefined` on every normal finish, including a turn that used its whole
   * `maxIterations` budget and then genuinely finished. It is set only when
   * the model was still asking for tools and the run refused to run them:
   * `maxIterations` was reached, or a `costBudget: { onExceed: 'halt' }` was
   * crossed.
   *
   * ## Why this is a method and not part of the answer
   *
   * `run()` resolves to a bare string. There is nowhere in a string to write
   * "…and three tool calls never ran", which is the same wall 8.6.0 hit with
   * an outstanding credential consent — and there the turn raises, because
   * handing back a plausible answer for work a tool never did is a silent
   * success. This is not that. A limit you configured firing is the limit
   * working, and the answer is sometimes real (a model can return content AND
   * tool calls). So it does not raise; it records, in committed state, where
   * it is provable after the fact — `getLastSnapshot().sharedState.stoppedEarly`
   * is the same value, and this is the short way to it.
   *
   * When the answer came back EMPTY the library also warns once on the
   * console, because an empty string reaching a user is indistinguishable
   * from a bug.
   *
   * @example
   * ```ts
   * const answer = await agent.run({ message: 'audit every log file' });
   * const cut = agent.stoppedEarly();
   * if (cut) {
   *   console.log(`stopped at iteration ${cut.iteration}: ${cut.reason}`);
   *   console.log(`${cut.pendingToolCalls} tool call(s) never ran`);
   * }
   * ```
   */
  stoppedEarly(): AgentState['stoppedEarly'] {
    const state = this.getLastSnapshot()?.sharedState as
      | Pick<AgentState, 'stoppedEarly'>
      | undefined;
    return state?.stoppedEarly;
  }

  /**
   * Did the last turn's answer FAIL this agent's `outputSchema` — and how (8.18.0)?
   *
   * `undefined` when the answer satisfied the contract, and on any agent with
   * no `.outputSchema()`. Set on every run whose final answer was judged and
   * rejected, including the default `retries: 0` case where the first answer is
   * the only one there was.
   *
   * ## Why a method, when `runTyped()` already throws
   *
   * Because `run()` does not, and `run()` is what a server, a queue worker and
   * `standingAgent` call. Before this existed, that caller received a string
   * that violated a contract they had declared, with nothing anywhere saying
   * so: the retries were billed, the ledger row was written under `retries > 0`
   * and absent under `retries: 0`, and the answer looked exactly like a good
   * one. `runTyped()` still throws `OutputSchemaError` — that is the caller
   * ASKING to be raised at, and it is unchanged.
   *
   * `brokenBy` is the case worth a dashboard: the model's answer PASSED and one
   * of your own `act({ output })` rules rewrote it into one that fails. The run
   * stops re-asking when that happens — a deterministic rule breaks the next
   * answer identically, so the retries would be bought for nothing.
   *
   * @example
   * ```ts
   * const answer = await agent.run({ message: 'summarise ticket 91' });
   * const unmet = agent.outputContractUnmet();
   * if (unmet) {
   *   log.warn({ stage: unmet.stage, error: unmet.error, brokenBy: unmet.brokenBy });
   *   return safeDefault;               // …rather than shipping `answer` as typed data
   * }
   * ```
   */
  outputContractUnmet(): AgentState['outputContractUnmet'] {
    const state = this.getLastSnapshot()?.sharedState as
      | Pick<AgentState, 'outputContractUnmet'>
      | undefined;
    return state?.outputContractUnmet;
  }

  /**
   * Did the last turn's answer state names or numbers that appear in NO tool
   * result (9.35.0)?
   *
   * `undefined` when every value was grounded — and on any agent without
   * `.namesAndNumbersFromEvidence()`. Set on a turn that shipped flagged
   * (`'assist'` / `'guard'`) and on one that was refused (`'rails'`, where
   * `run()` also raised `UnsupportedValuesError`, so this is what a caller
   * reads in the `catch`).
   *
   * `revised: true` means the model was asked once to correct the values and
   * they survived that turn — the fact worth alerting on, because it is a
   * model that cannot ground its own claims rather than one that slipped.
   *
   * Remember what the verdict does NOT say: values were invented. It cannot
   * tell you whether a claim built from real values is true.
   *
   * @example
   * ```ts
   * const answer = await agent.run({ message: 'which port is down?' });
   * const bad = agent.unsupportedValues();
   * if (bad) log.warn({ values: bad.values.map((v) => v.value), revised: bad.revised });
   * ```
   */
  unsupportedValues(): AgentState['unsupportedValues'] {
    const state = this.getLastSnapshot()?.sharedState as
      | Pick<AgentState, 'unsupportedValues'>
      | undefined;
    return state?.unsupportedValues;
  }

  private finalizeResult(
    executor: FlowChartExecutor,
    result: unknown,
  ): AgentOutput | RunnerPauseOutcome {
    const paused = this.detectPause(executor, result);
    if (paused) return paused;
    // Reliability fail-fast translation (v2.11.5+) — when the
    // reliability retry loop in callLLM hits a `fail-fast` decision,
    // it writes scope.reliabilityFailKind + payload and calls $break.
    // The chart stops; the executor returns the last finalContent
    // (typically empty). At the API boundary we surface the typed
    // error so consumers can `instanceof ReliabilityFailFastError`
    // and branch on `.kind`.
    if (this.reliabilityConfig !== undefined) {
      const snap = executor.getSnapshot();
      // Read via Pick<AgentState, …> so the read shape cannot drift from
      // the typed write side (the fields are declared once on AgentState).
      const state = snap.sharedState as Pick<
        AgentState,
        | 'reliabilityFailKind'
        | 'reliabilityFailPayload'
        | 'reliabilityFailReason'
        | 'reliabilityFailCauseMessage'
        | 'reliabilityFailCauseName'
      >;
      if (state.reliabilityFailKind !== undefined) {
        // Reconstruct the cause Error from the captured message+name —
        // see the matching note in reliabilityExecution.failFast about
        // why we don't keep the original Error in scope.
        let cause: Error | undefined;
        if (state.reliabilityFailCauseMessage !== undefined) {
          cause = new Error(state.reliabilityFailCauseMessage);
          if (state.reliabilityFailCauseName !== undefined) {
            cause.name = state.reliabilityFailCauseName;
          }
        }
        throw new ReliabilityFailFastError({
          kind: state.reliabilityFailKind,
          reason: state.reliabilityFailReason ?? state.reliabilityFailKind,
          ...(cause !== undefined && { cause }),
          ...(state.reliabilityFailPayload !== undefined && {
            payload: state.reliabilityFailPayload,
          }),
          snapshot: snap,
        });
      }
    }
    // Policy-halt translation (v2.12+) — when a `PermissionChecker` returns
    // `{ result: 'halt', ... }`, the toolCalls handler writes a synthetic
    // tool_result, emits `agentfootprint.permission.halt`, sets
    // scope.policyHalt* fields, and calls $break. The chart stops; we
    // surface the typed error here so callers can `instanceof PolicyHaltError`
    // and branch on `.reason` for alert routing.
    {
      const snap = executor.getSnapshot();
      const state = snap.sharedState as {
        policyHaltReason?: string;
        policyHaltTellLLM?: string;
        policyHaltTarget?: string;
        policyHaltArgs?: Readonly<Record<string, unknown>>;
        policyHaltIteration?: number;
        policyHaltCheckerId?: string;
        history?: import('../adapters/types.js').LLMMessage[];
      };
      if (state.policyHaltReason !== undefined && state.policyHaltTarget !== undefined) {
        const history = state.history ?? [];
        const iteration = state.policyHaltIteration ?? 1;
        // Sequence at halt time — derived from history. Includes the
        // proposed call (which DID land in history as the synthetic
        // tool_result for protocol compliance, but the policy denied
        // execution). Filter it out so callers see only dispatched
        // calls, then append the proposed entry as a hint.
        const sequenceWithoutProposed = extractSequence(history.slice(0, -1), iteration);
        throw new PolicyHaltError({
          reason: state.policyHaltReason,
          ...(state.policyHaltTellLLM !== undefined && { tellLLM: state.policyHaltTellLLM }),
          sequence: [
            ...sequenceWithoutProposed,
            { name: state.policyHaltTarget, args: state.policyHaltArgs, iteration },
          ],
          iteration,
          history,
          proposed: { name: state.policyHaltTarget, args: state.policyHaltArgs ?? {} },
          ...(state.policyHaltCheckerId !== undefined && { checkerId: state.policyHaltCheckerId }),
        });
      }
    }
    // Message-boundary refusal (7.18+) — a `messageMiddleware` returned
    // `deny`. The stage wrote the flags and (at 'input') broke the chart. We
    // surface the typed error here, the same way a policy halt is surfaced,
    // because a refusal must never be mistaken for an answer: at 'input' no
    // model was ever asked, and at 'output' the middleware has just declined
    // to release what the model said.
    if (this.messageMiddleware.length > 0) {
      const state = executor.getSnapshot().sharedState as Pick<
        AgentState,
        'messageDeniedReason' | 'messageDeniedPhase' | 'messageDeniedBy'
      >;
      if (state.messageDeniedReason !== undefined) {
        throw new MessageDeniedError({
          reason: state.messageDeniedReason,
          phase: state.messageDeniedPhase ?? 'output',
          middleware: state.messageDeniedBy ?? 'middleware',
        });
      }
    }
    // Evidence refusal (9.35.0, `posture: 'rails'` only) — the final answer
    // still states values that appear in no tool result, after the one
    // revision the posture allows. Surfaced the way a denied message is, and
    // for the same reason: `rails` was chosen precisely so an answer carrying
    // invented identifiers cannot reach the caller as a string they are free
    // to ignore. `'assist'` and `'guard'` never reach here — their verdict is
    // committed state and an event, and `run()` returns the answer.
    if (this.evidenceGate?.posture === 'rails') {
      const state = executor.getSnapshot().sharedState as Pick<AgentState, 'unsupportedValues'>;
      const verdict = state.unsupportedValues;
      if (verdict !== undefined && verdict.refused) {
        throw new UnsupportedValuesError({
          values: verdict.values,
          candidates: verdict.candidates,
          revised: verdict.revised,
          message: evidenceRefusalSentence(verdict.values, 'rails', verdict.revised),
        });
      }
    }
    // Credential-consent translation (8.6.0, `'tell-model'` only) — a tool
    // DECLARED a credential, the provider answered `authorization-required`,
    // and the model was told to route around it. The run reached the end
    // anyway, which means it is about to hand back an answer string for work a
    // tool never did.
    //
    // `AgentOutput` is a bare string, so there is nowhere to annotate "…and a
    // consent is still outstanding". An event alone would relocate the silent
    // success rather than remove it. So the turn raises, carrying the URL to
    // the caller — the party that can actually act on it. Under the default
    // `'pause'` this is unreachable for the first block (the run pauses and
    // `detectPause` returned above); it still fires if a RESUME found consent
    // ungranted and the model then finished the turn on its own.
    if (this.consentOutstanding.size > 0) {
      const [record] = [...this.consentOutstanding.values()];
      if (record) {
        this.consentOutstanding.clear();
        throw new CredentialConsentRequiredError(record);
      }
    }
    if (result instanceof Error) throw result;
    if (typeof result === 'string') return result;
    throw new Error('Agent: unexpected result shape — expected final-answer string');
  }

  // ─── Chart assembly ────────────────────────────────────────────

  private buildChart(): FlowChart {
    const provider = this.provider;
    const model = this.model;
    const temperature = this.temperature;
    const maxTokens = this.maxTokens;
    const systemPromptValue = this.systemPromptValue;
    const registry = this.registry;
    // (registryByName + toolSchemas redefined below using
    // `augmentedRegistry` which adds the auto-attached `read_skill`
    // tool when Skills are registered.)
    const _legacyRegistry = registry;
    void _legacyRegistry;
    const maxIterations = this.maxIterations;
    const pricingTable = this.pricingTable;
    const costBudget = this.costBudget;
    const permissionChecker = this.permissionChecker;
    const credentialProvider = this.credentialProvider;
    const artifactStore = this.artifactStore;
    // Cache layer (v2.6) — capture for the seed + chart-build closures.
    // `systemPromptCachePolicy` is fed into the CacheDecision subflow's
    // inputMapper. `cacheStrategy` is consulted by BuildLLMRequest at
    // run-time (Phase 7+ for the actual prepareRequest call). For
    // Phase 6b the chart mounts the stages but BuildLLMRequest is a
    // pass-through; Phase 7 lights up the strategy call.
    const systemPromptCachePolicy = this.systemPromptCachePolicy;
    const cachingDisabled = this.cachingDisabledValue;
    const cacheStrategy = this.cacheStrategy;

    // ── Steps-as-data (9.18.0): fold the declared procedures ONCE ──────
    // One frozen plan per stepped skill, threaded as closures into the four
    // seams that consult it (Evaluate re-key, tools-slot narrowing,
    // tool-calls advance/skip, the Route step judge + nudge). Empty →
    // `stepPlanFor` stays undefined and not one of those seams runs a new
    // line (zero-cost-when-unused).
    const stepPlans = foldStepPlans(this.injections);
    const stepPlanFor =
      stepPlans.size > 0 ? (skillId: string) => stepPlans.get(skillId) : undefined;

    // seed extracted to ./agent/stages/seed.ts (v2.11.2). Factory takes
    // chart-build-time constants + per-run mutable accessors so the
    // resume side-channel and current run id remain dynamic.
    // toolSchemas is finalized further down; pass a getter that reads
    // the eventual const at stage-execution time.
    let toolSchemasResolved: readonly LLMToolSchema[] = [];
    // The stores the conversation itself is kept in — the durable anchor seed
    // resolves the turn number against. Deduplicated (several memories over
    // one store is the common shape) and reference-stable, so the scan runs
    // once per store per run.
    const conversationStores = Array.from(
      new Set(
        this.memories
          .filter((m) => m.write !== undefined && m.corpus === undefined && m.store !== undefined)
          .map((m) => m.store as MemoryStore),
      ),
    );
    const seed = buildSeedStage({
      maxIterations,
      cachingDisabled,
      ...(costBudget !== undefined && { costBudgetOnExceed: costBudget.onExceed }),
      get toolSchemas() {
        return toolSchemasResolved;
      },
      consumePendingResumeHistory: () => {
        const h = this.pendingResumeHistory;
        this.pendingResumeHistory = undefined;
        return h;
      },
      consumePendingResumeFolded: () => {
        const f = this.pendingResumeFolded;
        this.pendingResumeFolded = undefined;
        return f;
      },
      // The conversation's inherited skill cursor (SG-C). Consumed (cleared)
      // on every run; HONORED only when the mounted graph declared
      // `continuity: 'conversation'` — the same one-option-one-behavior gate
      // the write side (`checkpoint()`) applies.
      consumePendingResumeSkillCursor: () => {
        const c = this.pendingResumeSkillCursor;
        this.pendingResumeSkillCursor = undefined;
        return c;
      },
      restoreSkillCursor: this.skillGraphCascade?.continuity === 'conversation',
      // Steps (9.18.0): gate the per-run stepPointer/stepNudgeSpent reset on
      // the feature, so every other agent seeds exactly the keys it always did.
      ...(stepPlanFor !== undefined && { hasSteps: true }),
      // Escalation (9.19.0): same gate discipline — the per-run counter/flip
      // reset exists only when the policy does (de-escalation IS the seed).
      ...(this.skillBrains?.escalation !== undefined && { hasEscalation: true }),
      // The evidence gate's one bounded revision (9.35.0) — a per-turn budget,
      // reset here. Only a posture that can revise writes the key.
      ...(this.evidenceGate !== undefined &&
        this.evidenceGate.posture !== 'assist' && { hasEvidenceRevision: true }),
      getCurrentRunId: () => this.currentRunContext?.runId,
      // WHO this run is for, when the caller named nobody (9.10.0). Seed uses
      // it for exactly one rung of the identity ladder — see `seedFrom` — and
      // an explicit identity outranks it there. Read through an accessor for
      // the same reason the runId is: the chart is built once, and this
      // changes every run.
      getCurrentSessionId: () => this.currentRunContext?.sessionId,
      // WHICH TURN THIS IS (9.6.0). Only memories that WRITE the conversation
      // are consulted: they are the ones whose entry ids are turn-stamped, and
      // a corpus (`.rag(...)`, which reads under its own namespace) has no
      // turns at all. Empty list → seed stays synchronous and makes no store
      // call, so an agent without memory is unchanged.
      ...(conversationStores.length > 0 && { conversationStores }),
      // The `'input'` half of the message chain, run BEFORE `userMessage` and
      // `history` are committed — see SeedStageDeps.messageMiddleware.
      ...(this.messageMiddleware.length > 0 && { messageMiddleware: this.messageMiddleware }),
      // `.configure()` — seed is where run-level facts are decided and
      // committed, so the resolver rides that commit. The closure supplies
      // the build-time defaults so a resolver can decide RELATIVE to them
      // ("upgrade the model when the message is long") instead of having to
      // restate them.
      ...(this.runConfigFn && {
        resolveRunConfig: (input: AgentInput): RunConfig | undefined => {
          const ctx: RunConfigContext = {
            message: input.message,
            ...(input.identity !== undefined && { identity: input.identity }),
            runId: this.currentRunContext?.runId ?? 'unknown',
            defaults: { model, instructions: systemPromptValue },
          };
          return this.runConfigFn?.(ctx);
        },
      }),
    });

    // Tool registry composition extracted to ./agent/buildToolRegistry.ts.
    // Composes static .tool() registry + auto-attached read_skill (+ the
    // auto-attached `present` tool when a store is attached, 9.22.0) +
    // skill-supplied tools (with autoActivate scoping); validates
    // name uniqueness; produces the dispatch map.
    const { registryByName, toolSchemas } = buildToolRegistry(registry, this.injections, {
      hasArtifactStore: artifactStore !== undefined,
    });
    // A statically registered tool that declares `wants` on an agent with no
    // store is configuration that lies: every call would be refused at
    // dispatch for a gap only the operator can close. Refused at BUILD,
    // naming the tool (provider-served tools are only met at dispatch — the
    // dispatch-time refusal covers those).
    if (artifactStore === undefined) {
      for (const [toolName, registered] of registryByName) {
        if (registered.wants !== undefined) {
          throw new Error(
            `Agent: tool '${toolName}' declares artifact arguments (wants: ` +
              `{ ${Object.entries(registered.wants)
                .map(([arg, kind]) => `${arg}: '${kind}'`)
                .join(', ')} }) but no artifact store is attached, so its refs could never ` +
              `resolve and every call would be refused. Pass \`artifacts\` to Agent.create ` +
              `(inMemoryArtifacts(), fileArtifacts({ directory }), sqliteArtifacts({ file }), ` +
              `or any ArtifactStore), or drop the tool's \`wants\`.`,
          );
        }
        // The same law for the typed-HITL half (9.24.0): a statically
        // registered `checkInComponent.propsRef` on a storeless agent is a
        // ref the screen could never redeem — every tripped gate would be
        // refused at raise for a gap only the operator can close.
        if (registered.checkInComponent?.propsRef !== undefined) {
          throw new Error(
            `Agent: tool '${toolName}' declares checkInComponent.propsRef ` +
              `('${registered.checkInComponent.propsRef}') but no artifact store is attached, ` +
              `so the answering screen could never redeem it and every tripped check-in would ` +
              `be refused at raise. Pass \`artifacts\` to Agent.create (inMemoryArtifacts(), ` +
              `fileArtifacts({ directory }), sqliteArtifacts({ file }), or any ArtifactStore), ` +
              `or carry the payload inline as checkInComponent.props.`,
          );
        }
      }
    }
    // The composedOf drift gate (9.76.0), judged HERE and not at defineTool —
    // the one moment the catalog is complete. A tool that declares its
    // ingredients (`composedOf`, the runbookAsTool law) whose ingredient was
    // renamed or never registered fails the BUILD by name, instead of failing
    // its first run inside a stage. Tools delivered by a ToolProvider are
    // invisible to this check (no build-time list — the 9.72.0 caveat), so
    // with a provider configured an unmatched name is a dev-mode heads-up
    // rather than a refusal: the ingredient may genuinely arrive at dispatch.
    for (const [composedName, registered] of registryByName) {
      for (const ingredient of registered.composedOf ?? []) {
        if (registryByName.has(ingredient)) continue;
        if (this.externalToolProvider !== undefined) {
          if (isDevMode()) {
            // eslint-disable-next-line no-console
            console.warn(
              `[agentfootprint] tool '${composedName}' declares composedOf ingredient ` +
                `'${ingredient}', which is not in the static catalog. A ToolProvider is ` +
                `configured, so it may arrive at dispatch — but provider-delivered tools ` +
                `cannot be drift-checked at build. If '${ingredient}' is static, this is ` +
                `the rename the check exists to catch.`,
            );
          }
          continue;
        }
        throw new Error(
          `Agent: tool '${composedName}' declares composedOf ingredient '${ingredient}', ` +
            `but no tool of that name is registered on this agent. The declaration names ` +
            `the tools its procedure calls through ctx.tools, and an ingredient that is ` +
            `not in the dispatch map fails at its first inner call — refused at build ` +
            `instead. Register '${ingredient}' (or fix the name in composedOf).`,
        );
      }
    }
    // Late-bind toolSchemas into the seed stage's deps (the factory was
    // built earlier with a getter; this resolves the actual value).
    toolSchemasResolved = toolSchemas;

    // The gate's admissible set, for the record (9.50.0): declared hops from
    // the cursor plus the open skills — the SAME two resolvers the read_skill
    // offer and the refusal messages are built from (`readSkillOfferFor`),
    // composed once here so `context.evaluated.cursorMove.reachable` can
    // never drift from the verdicts. Open ids are fixed after build, so they
    // are computed once, exactly as the offer builder does.
    const openForReachable = this.skillGraphReachable ? this.openSkillIds() : [];
    const injectionEngineSubflow = buildInjectionEngineSubflow({
      injections: this.injections,
      ...(this.skillGraphNextSkill && { nextSkill: this.skillGraphNextSkill }),
      ...(this.skillGraphExplainNextSkill && {
        explainNextSkill: this.skillGraphExplainNextSkill,
      }),
      ...(this.skillGraphReachable && {
        reachableSkills: (currentSkillId?: string) => [
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ...new Set([...this.skillGraphReachable!(currentSkillId), ...openForReachable]),
        ],
      }),
      ...(this.skillGraphSupersededEntries && {
        supersededEntries: this.skillGraphSupersededEntries,
      }),
      // Steps (9.18.0): the Evaluate stage owns the pointer's tenure re-key.
      ...(stepPlanFor !== undefined && { stepPlanFor }),
      // The maps kernel (9.58.0): the Evaluate stage owns the engagement
      // advance, with the same ctx the triggers gate on.
      ...(this.mapsPlan !== undefined && { engagement: this.mapsPlan }),
    });
    // The turn-start slot's occupant (SG-C). RouteTurn — the cascade — mounts
    // ONLY when the graph runs it: a classifier is configured, or the mount
    // declared `continuity: 'conversation'`. Every other graph keeps exactly
    // what it had: scorer graphs keep PickEntry byte-for-byte (no cascade, no
    // turn_routed — the zero-delta law), plain graphs keep no stage at all.
    const cascade = this.skillGraphCascade;
    const runsCascade =
      cascade !== undefined &&
      cascade.turnRouting !== undefined &&
      (cascade.turnRouting.scorer !== undefined || cascade.continuity === 'conversation');
    const hiddenSkillIdsForRouting = this.hiddenSkillIdsNow();
    const routeTurnStage = runsCascade
      ? makeRouteTurnStage({
          turnRouting: cascade.turnRouting!,
          ...(this.skillGraphScoreEntries && { scoreEntries: this.skillGraphScoreEntries }),
          continuity: cascade.continuity,
          strictness: cascade.strictness,
          isNode: (id) => cascade.nodeIds.has(id),
          ...(hiddenSkillIdsForRouting && { hiddenSkillIds: hiddenSkillIdsForRouting }),
          // The tier-3 decider (9.19.0) — the out-of-band menu resolver.
          // `AgentBuilder.build()` already refused a decider on a mount
          // that never runs the cascade, so it always reaches its stage.
          ...(this.skillBrains?.decider !== undefined && {
            decider: {
              provider: this.skillBrains.decider.provider,
              ...(this.skillBrains.decider.model !== undefined && {
                model: this.skillBrains.decider.model,
              }),
              defaultModel: model,
              runConfigured: this.runConfigFn !== undefined,
            },
          }),
        })
      : undefined;
    // Relevance entry router — a once-per-turn stage (off the ReAct loop) that
    // picks the starting skill by embedding similarity. Only built (and mounted)
    // when the graph was created with `.entryByRelevance()` AND the cascade did
    // not subsume it.
    const pickEntryStage =
      !routeTurnStage && this.skillGraphScoreEntries
        ? makePickEntryStage(this.skillGraphScoreEntries)
        : undefined;
    // With `.configure()` the base prompt becomes a function of the run: the
    // slot reads the instructions seed committed, falling back to `.system()`
    // when the resolver left it alone. `reason` follows the same fork so the
    // context record names whichever one actually supplied the text.
    // Per-slot budgets (8.11.0). Each key is forwarded only when the consumer
    // set it, so an unset slot keeps its own default rather than being pinned
    // to `undefined` at the call site.
    const budget = this.contextBudget;
    const systemPromptSubflow = buildSystemPromptSlot({
      ...(this.runConfigFn
        ? {
            prompt: (args: SystemPromptSlotArgs) => args.instructions ?? systemPromptValue,
            reason: (args: SystemPromptSlotArgs) =>
              args.instructions !== undefined ? 'Agent.configure()' : 'Agent.system()',
          }
        : {
            prompt: systemPromptValue,
            reason: 'Agent.system()',
          }),
      ...(budget?.systemPrompt !== undefined && { budgetCap: budget.systemPrompt }),
    });
    const messagesSubflow = buildMessagesSlot({
      ...(budget?.messages !== undefined && { budgetCap: budget.messages }),
    });
    // Per-run cache shared between buildToolsSlot (writer, each
    // iteration) and buildToolCallsHandler (reader, same iteration).
    // Holds the resolved Tool[] from `provider.list(ctx)` so dispatch
    // doesn't re-invoke `list()` — vital for async network providers.
    // A fresh chart (and thus fresh cache) is built per `agent.run()`,
    // so concurrent runs don't share state.
    const providerToolCache: ProviderToolCache = { current: [] };
    const readSkillFor = this.readSkillOfferFor();
    // Per-role skill visibility. Resolved by the tools slot, for the DESCRIPTION
    // and nothing else. An earlier draft of 9.84.0 cached the resolved ids here
    // so the read_skill gate could filter the self-call notice's move offer
    // through them; the notice no longer names a destination at all (see
    // `selfCallNotice`), so there is nothing left to filter and the cache is
    // gone with the clause that needed it. One resolver call per iteration, on
    // the one surface that speaks in the present tense.
    const hiddenSkillIds = this.hiddenSkillIdsNow();
    // Registration-time owner stamps (9.60.0) — the identity edges the
    // integrity checks read. Built once per chart from the registry.
    const toolOwners = new Map(
      registry
        .filter((r) => r.tool.owner !== undefined)
        .map((r) => [r.name, r.tool.owner!] as const),
    );
    // The declared argument-ground edges (9.60.0; catalog-wide since 9.72.0)
    // — read by callLLM's dangling-reference and unsupported-argument checks.
    //
    // Harvested from `registryByName` — the FULL declared catalog (static
    // `.tool()` registrations PLUS every skill-carried tool, autoActivate/
    // scoped ones included) — and not from the static registry alone, which
    // was the field bug a consumer's MCP parity work surfaced: an app whose
    // `argumentsFrom` tools all ride skills (delivered when a skill
    // activates) never armed the choice-seam pair, and its disposition rows
    // read {checked: 0, notApplicable: 1} forever while the app's own
    // comments believed the checks ran.
    //
    // ARMING IS COMPUTABLE UP FRONT, and that is a build-time fact, not a
    // hope: a skill tool's DECLARATION is known at chart build (defineSkill
    // carries the Tool object into `buildToolRegistry`'s dispatch map) even
    // though the tool reaches the model only after its skill activates — so
    // this harvest, and the `dangling` flag `beginIntegrityRun` reads at run
    // start, may see the whole catalog before any skill has fired. The
    // runtime checks stay correctly scoped on their own: dangling-reference
    // intersects this map with the tools THIS call actually served, and
    // unsupported-argument with the calls the model actually made.
    //
    // CAVEAT, stated rather than papered over: ToolProvider-DELIVERED tools
    // remain invisible here. `ToolProvider.list(ctx)` is opaque and
    // per-iteration — there is no build-time list to harvest — so a provider
    // tool declaring `argumentsFrom` arms nothing. (MCP tools are NOT in that
    // hole: `mcpClient(...).tools()` registers them statically, and 9.71.0
    // carries their declarations across the wire.)
    const toolGrounding = new Map(
      [...registryByName.entries()]
        .filter(([, tool]) => tool.argumentsFrom !== undefined)
        .map(([name, tool]) => [name, tool.argumentsFrom!] as const),
    );
    this.integrityDanglingPresent = toolGrounding.size > 0;
    // The column-type contract's declared half (9.78.0) — harvested from the
    // SAME catalog and with the same ToolProvider caveat, so an MCP-carried
    // `resultColumns` (which rides `_meta`) arms the check exactly as a
    // locally-defined one does.
    // `flatMap` rather than filter-then-assert: the narrowing is real here,
    // so the twin harvest above's non-null assertion is not inherited.
    const toolColumns = new Map(
      [...registryByName.entries()].flatMap(([name, tool]) =>
        tool.resultColumns === undefined ? [] : [[name, tool.resultColumns] as const],
      ),
    );
    this.integrityColumnsPresent = toolColumns.size > 0;
    // The staged-refs join's other half (grounded numbers): `Tool.wants` by
    // tool name, harvested the same way and with the same ToolProvider caveat.
    // Consumed only by the evidence gate (the callLLM nudge and the recheck
    // correction), so an agent without the gate never reads it.
    const toolWants = toolWantsOf(registryByName);
    const toolsSubflow = buildToolsSlot({
      tools: toolSchemas,
      ...(toolOwners.size > 0 && { toolOwners }),
      // The kernel's map cards, for the compose-seam integrity backstop.
      ...(this.mapsPlan !== undefined && {
        mountedMaps: this.mapsPlan.maps.map((m) => ({ id: m.id, toolNames: m.toolNames })),
      }),
      integrityLedger: this.integrityLedgerHolder,
      ...(this.externalToolProvider && { toolProvider: this.externalToolProvider }),
      ...(this.externalToolProvider && { providerToolCache }),
      ...(readSkillFor && { readSkillFor }),
      ...(hiddenSkillIds && { hiddenSkillIds }),
      ...(budget?.tools !== undefined && { budgetCap: budget.tools }),
      // Steps (9.18.0): per-step narrowing + banner + the skip_step offer.
      ...(stepPlanFor !== undefined && { stepPlanFor }),
    });

    // callLLM extracted to ./agent/stages/callLLM.ts (v2.11.2). Same
    // late-binding pattern as seed for toolSchemas (computed below).
    const callLLM = buildCallLLMStage({
      provider,
      model,
      ...(temperature !== undefined && { temperature }),
      ...(maxTokens !== undefined && { maxTokens }),
      ...(pricingTable !== undefined && { pricingTable }),
      ...(costBudget !== undefined && { costBudget }),
      maxIterations,
      cacheStrategy,
      get toolSchemas() {
        return toolSchemasResolved;
      },
      // The declared argument-ground edges (9.60.0) — value-conditional, so
      // an agent whose tools declare none runs the exact bytes it always did.
      ...(toolGrounding.size > 0 && { toolGrounding }),
      // The staged-refs nudge (grounded numbers) — armed only when the dial
      // is ON and a registered tool declares `wants`; otherwise the stage
      // reads nothing new and every request keeps its exact bytes.
      ...(this.evidenceGate?.nudge === true && toolWants.size > 0 && { toolWants }),
      // The external-ground door (9.72.0) — value-conditional for the same
      // reason: no provider, no key, byte-identical corpus assembly.
      ...(this.externalGrounds !== undefined && { externalGrounds: this.externalGrounds }),
      // The write-seam advisory's arming (9.77.0) — this stage owns only the
      // "no armed call this response" not-applicable note; the check itself
      // runs where the result is. Value-conditional on BOTH halves, so an
      // agent that never asked for it reads no new key.
      ...(this.noticeEmptyLookups && toolGrounding.size > 0 && { noticeEmptyLookups: true }),
      // The column-type contract's arming (9.78.0), same job and same
      // value-conditional law: this stage owns only the "no declaring tool
      // was called this response" not-applicable notes.
      ...(this.checkColumnTypes !== 'off' &&
        toolColumns.size > 0 && { columnDeclaringTools: new Set(toolColumns.keys()) }),
      integrityLedger: this.integrityLedgerHolder,
      ...(this.reliabilityConfig !== undefined && { reliability: this.reliabilityConfig }),
      ...(this.outputSchemaParser !== undefined && {
        outputSchemaParser: this.outputSchemaParser,
      }),
      // 7.26 — the synthetic tool, under `strategy: 'tool-forced'` only.
      ...(this.outputEnforcement?.schemaTool !== undefined && {
        schemaTool: this.outputEnforcement.schemaTool,
      }),
      ...(this.thinkingBudget !== undefined && { thinkingBudget: this.thinkingBudget }),
      // Only a configured agent reads `scope.resolvedModel` — see the dep's
      // JSDoc for why this is a build-time flag and not a runtime fallback.
      ...(this.runConfigFn && { runConfigured: true }),
      // Opt-in system-prompt capture (9.50.0) — value-conditional, so an agent
      // that never asked keeps byte-identical llm_start events.
      ...(this.recordSystemPromptValue && { recordSystemPrompt: true }),
      // "The cursor picks the brain" (9.19.0) — wired only when a per-skill
      // brain or an escalation exists, so every other agent's stage reads no
      // new scope key and resolves on the exact line it always did. The
      // per-brain cache strategies resolve HERE, once, where the agent's own
      // strategy (override included) is known: same-name brains keep it,
      // foreign providers get their registry default (markers are
      // provider-aware — the one genuinely risky seam, resolved statically).
      ...(this.skillBrains !== undefined &&
        (this.skillBrains.bySkill.size > 0 || this.skillBrains.escalation !== undefined) && {
          brainFor: buildBrainFor({
            brains: this.skillBrains,
            agentProviderName: provider.name,
            agentCacheStrategy: cacheStrategy,
          }),
        }),
    });

    // Window stage (7.16 as compaction; the strategy family since 7.17) —
    // built ONLY when `.window()` / `.compaction()` was called. When present
    // it becomes the ReAct loop target (see the chart builders), so it runs
    // once per iteration boundary with the previous call's adapter-reported
    // usage already measured by the meter.
    const windowStage =
      this.windowStrategy && this.compactionMeterHandle
        ? {
            strategyName: this.windowStrategy.name,
            run: buildWindowStage({
              strategy: this.windowStrategy,
              meter: this.compactionMeterHandle,
              agentModel: model,
              providerName: provider.name,
              getRunId: () => this.currentRunContext?.runId,
              // Value-conditional (the `repeatedCallNudge` precedent): an
              // agent on the default hands the stage exactly the deps object
              // it always did.
              ...(this.keepLastToolResults !== undefined && {
                keepLastToolResults: this.keepLastToolResults,
              }),
              ...(pricingTable !== undefined && { pricingTable }),
              ...(costBudget !== undefined && { costBudget }),
            }),
          }
        : undefined;

    // routeDecider extracted to ./agent/stages/route.ts (v2.11.2).
    // The Route decider carries the `'output'` half of the message chain when
    // one is configured — see buildRouteDeciderStage for why that seam and not
    // PrepareFinal. Without a chain this is the same function reference the
    // chart has always been handed.
    // 7.26 — the decider also judges the final answer against the schema when
    // the agent opted into enforcement, because it is the last stage that
    // still has a loop to send the answer back around. Without enforcement
    // this is the same function reference the chart has always been handed.
    // 9.18.0 — the decider also judges a would-be-final answer against the
    // active step procedure (nudge once / accept / cut-short) when a stepped
    // skill is registered. Without steps this is the same function reference
    // the chart has always been handed.
    // 9.35.0 — and the decider grounds the would-be-final answer in the
    // turn's own tool results when `.namesAndNumbersFromEvidence()` is
    // configured. Without it this is the same function reference the chart
    // has always been handed.
    // ── The out-of-budget wrap-up (9.56.0) — one build-time decision ───
    // Mounted when the agent can CALL a tool and did not opt out. The tool
    // test is not a nicety: a limit only cuts a turn short when tool calls
    // were pending (`decideBranch`'s `earlyStop`), so an agent with nothing to
    // call can never reach the branch — and mounting a node that can never run
    // would put a WrapUp box on every toolless agent's chart, in every
    // recording, forever. A `ToolProvider` counts even though its list is only
    // known per iteration: it might list one, and "might" is the whole
    // question a build-time mount can answer.
    const canCallTools = registryByName.size > 0 || this.externalToolProvider !== undefined;
    const hasWrapUp = canCallTools && this.wrapUpAtMaxIterations !== false;

    const routeDecider = buildRouteDeciderStage(
      this.messageMiddleware,
      this.outputEnforcement,
      stepPlanFor,
      this.evidenceGate,
      hasWrapUp,
      this.claimContract,
      this.integrityLedgerHolder,
      // THE CLAIM SEAM'S RECENCY READ (9.83.0). Value-conditional on both
      // halves, so an agent that armed neither hands the decider builder
      // exactly the arguments it always did — and `buildRouteDeciderStage`'s
      // no-judge fast path still returns the very function reference every
      // pre-9.83.0 chart was given.
      this.noticePriorTurnEvidence && this.evidenceGate !== undefined ? true : undefined,
    );

    // toolCallsHandler extracted to ./agent/stages/toolCalls.ts (v2.11.2).
    const toolCallsHandler = buildToolCallsHandler({
      registryByName,
      // The claim ledger accumulates only for an agent that declared a
      // contract to read it (9.61.0) — value-conditional, so every other
      // agent commits exactly what it always did.
      ...(this.claimContract !== undefined && { collectClaimFacts: true }),
      // THE WRITE SEAM (9.77.0) — `empty-lookup`. Handed the SAME harvested
      // map callLLM reads at the choice seam, so the two stages agree by
      // construction about which calls are armed. Value-conditional on both
      // halves — the operator's dial and at least one `argumentsFrom`
      // declaration — so an agent that asked for neither hands the handler
      // exactly the deps object it always did.
      ...(this.noticeEmptyLookups &&
        toolGrounding.size > 0 && {
          emptyLookupGrounding: toolGrounding,
          integrityLedger: this.integrityLedgerHolder,
        }),
      // THE WRITE SEAM'S other check (9.78.0) — the column-type contract.
      // Value-conditional on both halves for the same reason, so an agent
      // that asked for neither hands the handler exactly the deps object it
      // always did.
      ...(this.checkColumnTypes !== 'off' &&
        toolColumns.size > 0 && {
          columnDeclarations: toolColumns,
          columnCheckMode: this.checkColumnTypes,
          integrityLedger: this.integrityLedgerHolder,
        }),
      ...(this.externalToolProvider && { externalToolProvider: this.externalToolProvider }),
      ...(this.externalToolProvider && { providerToolCache }),
      ...(permissionChecker && { permissionChecker }),
      ...(credentialProvider && { credentialProvider }),
      // The claim-check store (9.21.0). Absent → not one new line runs in
      // dispatch: `ctx.artifacts` is the fail-closed teacher and no artifact
      // event can fire (zero-cost-when-unused).
      ...(artifactStore && { artifactStore }),
      // The placement threshold (9.22.0) — only ever set beside a store (the
      // option's own shape enforces it). Absent → results are never measured
      // against it and never placed.
      ...(this.artifactPlacement !== undefined && { placement: this.artifactPlacement }),
      ...(this.toolArgValidation && { toolArgValidation: this.toolArgValidation }),
      ...(this.maxToolResultChars !== undefined && {
        maxToolResultChars: this.maxToolResultChars,
      }),
      // The repeated-call nudge (9.26.0). Threaded ONLY when switched off —
      // the VALUE-conditional pattern, so an agent on the default hands the
      // handler exactly the deps object it always did.
      ...(this.repeatedCallNudge === false && { repeatedCallNudge: false }),
      // Skill-graph read_skill gate: bound the model's read_skill jumps to the
      // reachable set from the current cursor. Undefined → gate off (back-compat).
      ...(this.skillGraphReachable && {
        allowedSkillIds: this.skillGraphReachable,
        openSkillIds: this.openSkillIds(),
        skillGraphIsTree: this.skillGraphIsTree,
      }),
      // The mount kernel's plan (9.59.0) — the gate's THIRD admission class.
      // A `read_skill` pick of a PARKED map's member is a re-engagement, not
      // a hop: admitted even though the reachable set excludes the node the
      // cursor already stands on, and it never touches the cursor. Value-
      // conditional, so an agent without `.maps()` hands the handler exactly
      // the deps object it always did.
      ...(this.mapsPlan !== undefined && { engagementPlan: this.mapsPlan }),
      // The mount's routing posture (SG-C). `'assist'` — the default — is
      // deliberately NOT threaded: undefined keeps the gate byte-identical.
      ...(this.skillGraphCascade !== undefined &&
        this.skillGraphCascade.strictness !== 'assist' && {
          skillStrictness: this.skillGraphCascade.strictness,
        }),
      // Steps (9.18.0): advance/skip at the result boundary — the batch loop
      // AND every pausable resume path (an askHuman step advances on resume).
      ...(stepPlanFor !== undefined && { stepPlanFor }),
      // Escalate-on-evidence (9.19.0): the refusal budget + flip, wired only
      // when the policy exists. `describeFrom` resolves the event's honest
      // `from` by the same chain callLLM applies.
      ...(this.skillBrains?.escalation !== undefined && {
        escalation: {
          afterRefusals: this.skillBrains.escalation.afterRefusals,
          to: {
            provider: this.skillBrains.escalation.provider.name,
            ...(this.skillBrains.escalation.model !== undefined && {
              model: this.skillBrains.escalation.model,
            }),
          },
          describeFrom: (cursor: string | undefined, resolvedModel: string | undefined) =>
            describeServingBrain({
              brains: this.skillBrains!,
              cursor,
              agentProviderName: provider.name,
              defaultModel: model,
              ...(resolvedModel !== undefined && { resolvedModel }),
            }),
        },
      }),
      // The require-instruction catalog (9.19.0): every registered injection
      // id + the one delivery fact its check-up needs. Wired whenever
      // injections exist; nothing runs until a tool returns an effect.
      ...(this.injections.length > 0 && {
        leaseTargets: new Map(
          this.injections.map((inj) => {
            const surfaceMode = (inj.metadata as { surfaceMode?: string } | undefined)?.surfaceMode;
            return [inj.id, { ...(surfaceMode !== undefined && { surfaceMode }) }] as const;
          }),
        ),
      }),
      // Check-in (evidence-carrying human consent). Always threaded (resolved
      // default); the gate fires only for tools that declared `checkIn`.
      checkIn: this.checkInConfig,
      // The governance chain. Threaded only when non-empty so an agent without
      // one produces the same handler behaviour it always did.
      ...(this.toolMiddleware.length > 0 && { toolMiddleware: this.toolMiddleware }),
      // Durable-write barrier. An ACCESSOR, never a captured value: the chart is
      // built once at construction and a session composer installs its barrier
      // later, so a direct field read here would be stale forever. Answers
      // `undefined` — no await, no microtask — until one is installed.
      awaitDurable: () => pendingDurableWrite(this),
      // 9.7.0 — run/session identity and the teardown registrar. BOTH are
      // accessors for the reason `awaitDurable` is one: the chart is built once
      // at construction, and a captured value would be run #1's forever. The
      // tier one is lazy on top of that — an agent whose tools hold no sessions
      // never allocates it.
      currentRun: () => this.toolRunFacts(),
      toolSessions: () => this.toolSessions(),
      // 8.6.0 — what a run does when a declared credential needs 3LO consent.
      onAuthorizationRequired: this.onAuthorizationRequired,
      // The `'tell-model'` consent record travels OFF tracked state (a tracked
      // write is a commit-log entry, and the URL is a bearer capability), so
      // these two callbacks are its whole route to the caller. Cleared at the
      // top of every run; read in `finalizeResult`.
      reportConsentOutstanding: (record) => {
        this.consentOutstanding.set(record.service, record);
      },
      clearConsentOutstanding: (service) => {
        this.consentOutstanding.delete(service);
      },
    });

    // v2.14 — Build the NormalizeThinking sub-subflow only when a
    // ThinkingHandler resolved (auto-wired by provider.name OR
    // explicitly set via .thinkingHandler()). Conditional mount ensures
    // zero overhead for non-thinking agents — the chart has zero extra
    // stages when undefined.
    const thinkingSubflow = this.thinkingHandler
      ? buildThinkingSubflow(this.thinkingHandler)
      : undefined;

    // Chart composition extracted to ./agent/buildAgentChart.ts (v2.11.2).
    // The deps object is identical for both chart shapes — only the
    // wiring differs (flat call-llm stage vs sf-llm-call subflow).
    const chartDeps = {
      memories: this.memories,
      // Evidence bridge (#5): closure hand-off to the CAUSAL write mounts.
      ...(this.causalEvidence && { causalEvidenceSource: this.causalEvidence.collect }),
      systemPromptCachePolicy,
      maxIterations,
      seed,
      callLLM,
      routeDecider,
      toolCallsHandler,
      // The re-ask branch — mounted only when there are retries to spend. A
      // `'tool-forced'` agent with `retries: 0` gets the constrained shape and
      // no branch: there is nothing for a branch to do.
      ...(this.outputEnforcement !== undefined &&
        this.outputEnforcement.retries > 0 && {
          outputRetryStage: buildOutputRetryStage(this.outputEnforcement) as (scope: never) => void,
        }),
      // The unfinished-steps nudge branch (9.18.0) — mounted only when a
      // stepped skill exists, same conditional-mount law as the re-ask above.
      ...(stepPlanFor !== undefined && {
        hasSteps: true,
        stepNudgeStage: buildStepNudgeStage(stepPlanFor) as (scope: never) => void,
      }),
      // The maps kernel (9.58.0) — gates the mapEngagement alias round trip
      // through the engine boundary. Same conditional-mount law as steps.
      ...(this.mapsPlan !== undefined && { engagementPlan: this.mapsPlan }),
      // The evidence gate (9.35.0). `hasEvidenceGate` rides ANY posture (the
      // grouped chart needs the system-prompt records bubbled out to exempt
      // what the app itself supplied); the BRANCH is mounted only for a
      // posture that can revise — `'assist'` records and never loops, so it
      // gets no branch and no stage, the same conditional-mount law as above.
      ...(this.evidenceGate !== undefined && {
        hasEvidenceGate: true,
        ...(this.evidenceGate.posture !== 'assist' && {
          evidenceRecheckStage: buildEvidenceRecheckStage(
            this.evidenceGate,
            // The staged-refs join (grounded numbers) — the correction names
            // the refs and the spender when the run declared both. Threaded
            // whenever a `wants` tool exists (not gated on `nudge`: a
            // revision that cannot say HOW to compute leaves the model to
            // head-math again); absent for every agent without one, so the
            // correction keeps its exact bytes.
            toolWants.size > 0
              ? {
                  toolWants,
                  staticToolNames: () => toolSchemasResolved.map((t) => t.name),
                }
              : undefined,
          ) as (scope: never) => void,
        }),
      }),
      // Escalation (9.19.0): the grouped chart threads `skillEscalated`
      // across the sf-llm-call boundary only when the policy exists.
      ...(this.skillBrains?.escalation !== undefined && { hasEscalation: true }),
      // `.limitsTravelWithTheAnswer()` (this release) — value-conditional, the
      // `resolvedModel` precedent: absent from the deps object entirely for an
      // agent that did not ask, so both builders mount the final-branch stage
      // function they have always mounted.
      ...(this.limitsTravelWithTheAnswerValue && { attachCoverageLimits: true }),
      // The out-of-budget wrap-up branch (9.56.0) — the conditional-mount law
      // above, decided once beside the Route decider that routes to it so the
      // two can never disagree about whether the branch exists.
      ...(hasWrapUp && { wrapUpStage: wrapUpStage as (scope: never) => void }),
      injectionEngineSubflow,
      ...(pickEntryStage && { pickEntryStage }),
      ...(routeTurnStage && { routeTurnStage: routeTurnStage as (scope: never) => Promise<void> }),
      // Messages-slot delivery (7.21) — mounted ONLY when something could
      // target the slot. A registered injection declaring `inject.messages`
      // is the obvious case; a `.memory()` is the other, because a hand-built
      // read subflow may format its recall as a non-system role and that
      // recall only exists at run time. An agent with neither gets no stage
      // and no write, so its chart and its commit log are what they were.
      ...((this.injections.some((i) => (i.inject?.messages?.length ?? 0) > 0) ||
        this.memories.length > 0) && {
        deliverStage: buildDeliverStage({
          provider: this.provider,
          memoryIds: this.memories.map((m) => m.id),
        }) as (scope: never) => void,
      }),
      systemPromptSubflow,
      messagesSubflow,
      toolsSubflow,
      ...(thinkingSubflow !== undefined && { thinkingSubflow }),
      updateSkillHistoryStage,
      ...(windowStage !== undefined && { windowStage }),
      // Gate the UpdateSkillHistory stage on skills being registered —
      // same idiom buildToolRegistry uses to auto-attach `read_skill`.
      hasSkills: this.injections.some((i) => i.flavor === 'skill'),
      // Builders only branch on classic-vs-dynamic SEMANTICS; the grouped
      // chart shape is selected below by choosing buildDynamicAgentChart.
      reactMode: (this.reactMode === 'classic' ? 'classic' : 'dynamic') as 'classic' | 'dynamic',
      ...(this.structureRecorders !== undefined && {
        structureRecorders: [...this.structureRecorders],
      }),
    };

    // `'dynamic-grouped'` wraps the whole LLM turn in an `sf-llm-call` subflow —
    // the same boundary LLMCall produces — so Lens / explainable-ui render it as
    // an LLM group with its slots inside. `'classic'` and `'dynamic'` use the
    // flat chart; they differ only in `chartDeps.reactMode` (whether the Context
    // selector re-engineers the static slots each turn). Grouping is dynamic-only
    // (it re-seeds context every turn by design), so there is no classic-grouped.
    return this.reactMode === 'dynamic-grouped'
      ? buildDynamicAgentChart(chartDeps)
      : buildAgentChart(chartDeps);
  }
}

// AgentBuilder extracted to ./agent/AgentBuilder.ts (v2.11.2).
// Re-export so the 28+ existing import sites continue to work unchanged.

// Validators + helpers extracted to ./agent/validators.ts (v2.11.1).
