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
import { SUBFLOW_IDS } from '../conventions.js';
import {
  DecisionRequiredError,
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
import { EmitBridge } from '../recorders/core/EmitBridge.js';
import { buildWindowStage } from './agent/stages/window.js';
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
import { buildInjectionEngineSubflow } from '../lib/injection-engine/buildInjectionEngineSubflow.js';
import type { Injection, InjectionContext } from '../lib/injection-engine/types.js';
import type { CursorMove, EntryScoring } from '../lib/injection-engine/skillGraph.js';
import { makePickEntryStage } from './agent/stages/pickEntry.js';
import { applyOutputFallback, type ResolvedOutputFallback } from './outputFallback.js';
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
  AgentInput,
  AgentOptions,
  AgentOutput,
  AgentState,
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
import type { ToolArgValidationMode } from './agent/toolArgsValidation.js';
import { buildAgentChart } from './agent/buildAgentChart.js';
import { buildDynamicAgentChart } from './agent/buildDynamicAgentChart.js';
import { buildToolRegistry } from './agent/buildToolRegistry.js';
import { AgentBuilder } from './agent/AgentBuilder.js';
import { buildThinkingSubflow } from './slots/buildThinkingSubflow.js';
import { findThinkingHandler } from '../thinking/registry.js';
import type { ThinkingHandler } from '../thinking/types.js';
export { AgentBuilder };

// Re-export public Agent types so the 28+ existing import sites
// (e.g., `import { type AgentInput } from '../core/Agent.js'`) keep
// working while implementation gradually moves into `./agent/*`.
// Public types canonically live in `./agent/types.ts` (v2.11.1).
export type {
  AgentInput,
  AgentOptions,
  AgentOutput,
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
  private readonly pricingTable?: PricingTable;
  /** Normalized at construction: a bare number is `{ usd, onExceed: 'warn' }`. */
  private readonly costBudget?: ResolvedCostBudget;
  /** Per-slot character budgets (8.11.0). Absent keys keep the slot default. */
  private readonly contextBudget?: AgentOptions['contextBudget'];
  private readonly permissionChecker?: PermissionChecker;
  private readonly toolArgValidation?: ToolArgValidationMode;
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
      const emit = (eventType: string, payload: Record<string, unknown>): void => {
        try {
          this.dispatcher.dispatch({
            type: eventType,
            timestamp: Date.now(),
            payload,
          } as never);
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
    // (helper used in the catch block below — module-private function
    // declared at file end via hoisting)
    const executor = this.createExecutor(options);
    this.inFlightRunId = this.currentRunContext.runId;

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
          cause instanceof CredentialConsentRequiredError);
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
        );
        throw new RunCheckpointError(cause, checkpoint);
      }
      throw cause;
    } finally {
      stopTracking();
      this.inFlightRunId = undefined;
      // `seed` consumes the restored conversation on its way past. A run that
      // died BEFORE seed never did, and a history left armed here would be
      // picked up by the next run — which would then continue a conversation
      // nobody asked it to. One run, one continuation.
      this.pendingResumeHistory = undefined;
      this.pendingResumeFolded = undefined;
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
    const executor = this.createExecutor(options);
    this.inFlightRunId = this.currentRunContext.runId;
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
      return finalized;
    } catch (cause) {
      await this.endRunToolSessions(cause);
      throw cause;
    } finally {
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
    };
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
   *   • no graph → `undefined`. A plain `read_skill` agent has no cursor and no
   *     gate; every registered skill really is reachable, and the tool keeps its
   *     byte-identical description.
   *   • `reactMode: 'classic'` → `undefined`, plus a dev-mode warning. Classic
   *     composes the tools slot on turn 1 ONLY (see the Context selector's
   *     `includeStatic`), so a cursor-scoped menu would freeze at the cold-start
   *     cursor and keep advertising it for the rest of the run — a worse lie than
   *     the honest full catalog. `.selfExplain()` refuses under classic for exactly
   *     this caching reason; here the full catalog is a correct fallback, so this
   *     warns instead of refusing.
   */
  private readSkillOfferFor(): ((currentSkillId?: string) => LLMToolSchema) | undefined {
    if (!this.skillGraphReachable) return undefined;
    const skills = this.injections.filter((i) => i.flavor === 'skill');
    if (skills.length === 0) return undefined;
    if (this.reactMode === 'classic') {
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
      return undefined;
    }
    const open = this.openSkillIds();
    const reachable = this.skillGraphReachable;
    return (currentSkillId?: string) => {
      const grantable = [...new Set([...reachable(currentSkillId), ...open])];
      // Non-null: `skills` is non-empty, so the builder always returns a tool.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return buildReadSkillTool(skills, { grantable })!.schema;
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
    this.currentRunContext = {
      runStartMs: Date.now(),
      runId: makeRunId(),
      compositionPath: [`Agent:${this.id}`],
      ...(correlationId !== undefined && { correlationId }),
      ...(traceId !== undefined && { traceId }),
      // Session identity rides beside runId, not instead of it: one session
      // produces many runs, and an event needs to say which of each it is.
      ...(sessionId !== undefined && { sessionId }),
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
    return executor;
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
    // Cache layer (v2.6) — capture for the seed + chart-build closures.
    // `systemPromptCachePolicy` is fed into the CacheDecision subflow's
    // inputMapper. `cacheStrategy` is consulted by BuildLLMRequest at
    // run-time (Phase 7+ for the actual prepareRequest call). For
    // Phase 6b the chart mounts the stages but BuildLLMRequest is a
    // pass-through; Phase 7 lights up the strategy call.
    const systemPromptCachePolicy = this.systemPromptCachePolicy;
    const cachingDisabled = this.cachingDisabledValue;
    const cacheStrategy = this.cacheStrategy;

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
    // Composes static .tool() registry + auto-attached read_skill +
    // skill-supplied tools (with autoActivate scoping); validates
    // name uniqueness; produces the dispatch map.
    const { registryByName, toolSchemas } = buildToolRegistry(registry, this.injections);
    // Late-bind toolSchemas into the seed stage's deps (the factory was
    // built earlier with a getter; this resolves the actual value).
    toolSchemasResolved = toolSchemas;

    const injectionEngineSubflow = buildInjectionEngineSubflow({
      injections: this.injections,
      ...(this.skillGraphNextSkill && { nextSkill: this.skillGraphNextSkill }),
      ...(this.skillGraphExplainNextSkill && {
        explainNextSkill: this.skillGraphExplainNextSkill,
      }),
      ...(this.skillGraphSupersededEntries && {
        supersededEntries: this.skillGraphSupersededEntries,
      }),
    });
    // Relevance entry router — a once-per-turn stage (off the ReAct loop) that
    // picks the starting skill by embedding similarity. Only built (and mounted)
    // when the graph was created with `.entryByRelevance()`.
    const pickEntryStage = this.skillGraphScoreEntries
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
    const toolsSubflow = buildToolsSlot({
      tools: toolSchemas,
      ...(this.externalToolProvider && { toolProvider: this.externalToolProvider }),
      ...(this.externalToolProvider && { providerToolCache }),
      ...(readSkillFor && { readSkillFor }),
      ...(budget?.tools !== undefined && { budgetCap: budget.tools }),
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
    const routeDecider = buildRouteDeciderStage(this.messageMiddleware, this.outputEnforcement);

    // toolCallsHandler extracted to ./agent/stages/toolCalls.ts (v2.11.2).
    const toolCallsHandler = buildToolCallsHandler({
      registryByName,
      ...(this.externalToolProvider && { externalToolProvider: this.externalToolProvider }),
      ...(this.externalToolProvider && { providerToolCache }),
      ...(permissionChecker && { permissionChecker }),
      ...(credentialProvider && { credentialProvider }),
      ...(this.toolArgValidation && { toolArgValidation: this.toolArgValidation }),
      // Skill-graph read_skill gate: bound the model's read_skill jumps to the
      // reachable set from the current cursor. Undefined → gate off (back-compat).
      ...(this.skillGraphReachable && {
        allowedSkillIds: this.skillGraphReachable,
        openSkillIds: this.openSkillIds(),
        skillGraphIsTree: this.skillGraphIsTree,
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
      injectionEngineSubflow,
      ...(pickEntryStage && { pickEntryStage }),
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
