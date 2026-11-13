import type { ModelConfiguration } from './model.js';
import type { AroundTurn } from '../../aroundTurn/index.js';
import type { ReadTrackingMode } from 'footprintjs';
import type { CommitValuesMode } from 'foottrace';

import type { ReliabilityConfig } from '../../../../reliability/types.js';
import type { DecisionLedger } from '../../../consentRequest.js';
import type { PermissionChecker, PricingTable } from '../../../../provider-contract/types.js';
import type { CredentialProvider } from '../../../../identity/types.js';
import type { ArtifactStore } from '../../../../artifacts/types.js';
import type { ArtifactPlacement } from '../../../../artifacts/placement.js';
import type { AuthorizationRequiredMode } from '../../../../identity/consent.js';
import type { IntegrityPosture } from '../../../../integrity/disposition/lifecycle.js';
import type { SkillGraphDeclaredMap } from '../../skillGraphDeclared.js';
import type { AppliedRecipe } from '../../../../recipes/types.js';
import type { WindowStrategy } from '../../window/strategy.js';
import type { ResolvedCheckInConfig } from '../../../checkin.js';
import type { ResolvedCostBudget } from '../../../cost.js';
import type { MemoryDefinition } from '../../../../memory/define.types.js';

import type { ResolvedOutputFallback } from '../../../outputFallback.js';
import type { OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import type { ReadTimeOptions } from '../../../../time/clock.js';
import type { ResolvedOutputEnforcement } from '../../outputEnforcement.js';

import type { ToolProvider } from '../../../../tools/toolProvider.js';
import type {
  AgentOptions,
  AgentRecordingsOptions,
  ExternalGroundsProvider,
  ObserverDeliveryOptions,
  RunConfigFn,
  WriteProvenanceMode,
} from '../../types.js';
import type {
  ResolvedNegativeClaims,
  ResolvedTypedNegativeClaims,
} from '../../negativeClaims/config.js';
import type { ResolvedAnswerValidation } from '../../../../answer-validation/index.js';
import type { MessageMiddleware, ToolMiddleware } from '../../middleware/types.js';
import type { ToolArgValidationMode } from '../../../../tools/toolArgsValidation.js';
import type { ThinkingHandler } from '../../../../thinking/types.js';

/** Static run-policy and service declarations, resolved once at construction. */
export interface AgentConfiguration extends ModelConfiguration {
  /** Side channel for the conversation's inherited skill cursor (SG-C) —
   *  stashed by `applyContinuation`, consumed-and-cleared by seed. */
  readonly pricingTable?: PricingTable;

  /** Normalized at construction: a bare number is `{ usd, onExceed: 'warn' }`. */
  readonly costBudget?: ResolvedCostBudget;

  /** Per-slot character budgets (8.11.0). Absent keys keep the slot default. */
  readonly contextBudget?: AgentOptions['contextBudget'];

  readonly permissionChecker?: PermissionChecker;

  readonly toolArgValidation?: ToolArgValidationMode;

  /** See AgentOptions.findings (9.101.0). Set by `.findings()` and undefined
   *  on every other agent — the one value every findings gate below is
   *  conditioned on, so an unarmed agent hands each stage exactly the deps
   *  it always did. `serve` is threaded to seed (the run constant
   *  `findingsServe`) and to call-llm (`findingsServe` in its deps) on an
   *  armed agent only; `answerAsk` (9.103.0) rides the same two threads
   *  as `findingsAnswerAsk`, and only when it is `'quote-facts'` — the
   *  default `'none'` threads nothing. `keepLedgerFacts` is resolved once, here in the
   *  constructor (this door over `AgentOptions.keepLedgerFacts`), into the
   *  `keepLedgerFacts` field below and threaded to the window stage on an
   *  armed agent with a window, where `stages/window.ts · buildWindowStage`
   *  spends it as the `'ledger-fact'` pin ceiling. */
  readonly findingsOptions?: NonNullable<AgentOptions['findings']>;

  /** `.inputsLayer()` (honesty layer 2): mount the inputs layer even when no
   *  registered tool declares `askOrAssume` — for ruled tools only a
   *  ToolProvider serves, which the build cannot see. */
  readonly inputsLayerOption?: true;

  /** DECLARED SOURCES (honesty layer 2): `.findings({ argumentSources: true })`
   *  or `.inputsLayer({ argumentSources: true })` — resolved ONCE, in the
   *  constructor, from either door; every declared-sources gate below reads
   *  this one value, so the two doors can never arm different halves. The
   *  findings ledger's own serve stays `findingsOptions`'s: without
   *  `.findings()` the arm plants `_findings.from` on ruled tools only. */
  readonly argumentSourcesArmed?: true;

  /** `AgentOptions.argumentAskContext` (honesty layer 2): the host's own
   *  context for the inputs layer's batch ask, handed to the dispatch stage
   *  only when the layer is mounted. */
  readonly argumentAskContext?: () => Readonly<Record<string, unknown>>;

  /** `.resultsLayer()` (honesty layer 3, step 7b): mount the results layer
   *  even when no registered tool declares a `ToolPeriod` — for tools a
   *  ToolProvider serves, and for tools that declare a period only on their
   *  results. */
  readonly resultsLayerOption?: true;

  /** `.answerLayer()` (honesty layer 4): the answer's standing folded at the
   *  head of the final branch and served as data; `standingLine` — also one
   *  line appended to a prose answer, for the standings its mode names
   *  (`'always'` for `standingLine: true`). Undefined on every agent that did not
   *  ask, and that undefined is the whole zero-cost guarantee: no stage, no
   *  witness row, no stamp, no event, no bridge. */
  readonly answerLayerOption?: {
    readonly standingLine?: import('../../assessment/compose.js').StandingLineWhen;
  };

  /** `.time()` (the time layer, `time/`): the fallback zone, as read.
   *  Undefined on every agent that did not ask — then no clock is read, no
   *  time row is filed and `time` on a run is refused. */
  readonly timeOptions?: ReadTimeOptions;

  /** The clock the CURRENT `run()`'s seed stamps — set by `run()` (a run with
   *  no zone gets an unknown one, never the server's), read by seed through `SeedStageDeps.timeClock`, and
   *  cleared when `run()` ends, so a later turn this agent did not start (its
   *  chart mounted in a composition) never stamps a clock nobody declared for
   *  it (`seedClockDraft`). */
  /** The incoming request each of this agent's OWN scopes serves — recorded
   *  by the executor that made the scope (`createExecutor`), so a scope keeps
   *  ITS run's request for as long as it lives: a stage still running after
   *  its run was aborted can never be served the next run's request. A stage
   *  mounted in another runner's executor reads its run's request by link
   *  (`memberRun.ts`). Never written to scope. */
  /** The `time` the CURRENT resume passed, as read — TAKEN once by the first
   *  ToolCalls pass of the resumed leg (`ToolCallsHandlerDeps.time`), and
   *  cleared when `run()` or `resume()` ends. */
  /** Tool choice by classifier (9.105.0, `.toolChoice()`): the classifier,
   *  the serve dial and the app's own doors. Threaded to the tools slot (the
   *  pick and the narrowing), to call-llm (`toolChoice: true`, the outcome
   *  row) and to both chart builders (`hasToolChoice`, the mount args) on an
   *  armed agent only — an unarmed agent hands each stage exactly the deps it
   *  always did. */
  readonly toolChoiceOptions?: NonNullable<AgentOptions['toolChoice']>;

  /** The declared ontology (9.106.0, `.ontology()`): the frozen map. Threaded
   *  to seed (the whole map, written once as the run constant `ontology`),
   *  to call-llm (`ontology: true`, the gate on every read of that key) and
   *  to both chart builders (`hasOntology`, the grouped boundary's crossing)
   *  on an armed agent only — an unarmed agent hands each stage exactly the
   *  deps it always did. The tool names its `via` edges name are checked
   *  against the registry in `buildChart`, beside `buildToolRegistry`. */
  readonly ontology?: NonNullable<AgentOptions['ontology']>;

  /** The opt-in tool-result ceiling in characters (9.11.0). Absent → results
   *  are never measured. See {@link AgentOptions.maxToolResultChars}. */
  readonly maxToolResultChars?: number;

  /** Resolved check-in config (evidence-carrying human consent). Always
   *  present — defaults to `standard` evidence + the lexical scorer, so a tool
   *  that declares `checkIn` works even without a `.checkIn()` builder call. */
  readonly checkInConfig: ResolvedCheckInConfig;

  /** Where answered consent requests are spent (`AgentOptions.decisionLedger`).
   *  Undefined → this process's ledger, shared by every agent that names none. */
  readonly decisionLedger?: DecisionLedger;

  /** Per-run config resolver from `.configure()`. Undefined for every agent
   *  that never called it — and the chart is then built exactly as before,
   *  with no scope writes and no scope reads added. */
  readonly runConfigFn?: RunConfigFn;

  /** The agent's one window strategy. Undefined = no window stage, loop
   *  target unchanged, run byte-identical to an agent without it. */
  readonly windowStrategy?: WindowStrategy;

  /** The tool-dispatch chain (`.toolMiddleware()`), in declaration order.
   *  Empty for every agent that never called it — and then the dispatch loop
   *  never walks a chain, never writes the ledger key, and never emits. */
  readonly toolMiddleware: readonly ToolMiddleware[];

  /** The message chain (`.messageMiddleware()`), in declaration order. Empty
   *  keeps seed synchronous and prepare-final untouched. */
  readonly messageMiddleware: readonly MessageMiddleware[];

  /** `.aroundTurn()`, or undefined: the funnel then adds nothing to a turn. */
  readonly aroundTurnPort: AroundTurn | undefined;

  /** Snapshot read-tracking policy (#18/#14) — forwarded to the internal
   *  executor. Agent default is `'summary'` (cheap markers), NOT
   *  footprintjs's `'full'`. See AgentOptions.readTracking. */
  readonly readTracking: ReadTrackingMode;

  /** Commit-log value encoding (#13c-B) — forwarded to the internal
   *  executor. Agent default is `'delta'` (append/delete verbs; growing
   *  arrays like `history` record only their tails — lossless, linear
   *  retained memory), NOT footprintjs's `'full'`. See
   *  AgentOptions.commitValues. */
  readonly commitValues: CommitValuesMode;

  /** Per-write read provenance (#P1) — forwarded to the internal executor.
   *  Default `'off'` (footprintjs's own): recordings stay byte-identical
   *  unless a consumer opts in. See AgentOptions.writeProvenance. */
  readonly writeProvenance: WriteProvenanceMode;

  readonly credentialProvider?: CredentialProvider;

  /** The claim-check store (9.21.0). When set, every tool's `ctx.artifacts`
   *  is this store bound to the run's scope. See AgentOptions.artifacts. */
  readonly artifactStore?: ArtifactStore;

  /** The placement threshold (9.22.0) — the operator's ref-ing dial from the
   *  object form of AgentOptions.artifacts. Only ever set beside a store. */
  readonly artifactPlacement?: ArtifactPlacement;

  /** Recordings-as-artifacts (9.26.0) — the operator's dial from the object
   *  form of AgentOptions.artifacts. Only ever set beside a store; absent
   *  means no recorder is ever attached and no run is ever recorded. */
  readonly artifactRecordings?: AgentRecordingsOptions;

  /** The repeated-call nudge (9.26.0) — `false` only when the operator turned
   *  it off. See AgentOptions.repeatedCallNudge. */
  readonly repeatedCallNudge?: boolean;

  /** The out-of-budget wrap-up (9.56.0) — `false` only when the operator
   *  turned it off. See AgentOptions.wrapUpAtMaxIterations. */
  readonly wrapUpAtMaxIterations?: boolean;

  /** The last-tool-result pin (9.57.0) — set only when the operator named a
   *  value other than the default 2. See AgentOptions.keepLastToolResults. */
  readonly keepLastToolResults?: number | false;

  /** The ledger-fact hold's ceiling (9.102.0), RESOLVED — set exactly when
   *  `.findings()` is on: `findings({ keepLedgerFacts })` over
   *  `AgentOptions.keepLedgerFacts`, `false` → `0`, nothing named →
   *  `DEFAULT_KEEP_LEDGER_FACTS`. Undefined on every unarmed agent, so the
   *  thread into the window stage reads as the decision it is. See
   *  AgentOptions.keepLedgerFacts. */
  readonly keepLedgerFacts?: number;

  /** See AgentOptions.integrityPosture (9.60.0). Default 'observe'. */
  readonly integrityPosture: IntegrityPosture;

  /** See AgentOptions.noticeEmptyLookups (9.77.0). Default false — absent is
   *  byte-identical, save for the registered not-applicable ledger row. */
  readonly noticeEmptyLookups: boolean;

  /** See AgentOptions.noticePriorTurnEvidence (9.83.0). Default false —
   *  absent is byte-identical, save for the registered not-applicable ledger
   *  row. */
  readonly noticePriorTurnEvidence: boolean;

  /** See AgentOptions.checkColumnTypes (9.78.0). Default 'off' — absent is
   *  byte-identical, save for the registered not-applicable ledger rows. */
  readonly checkColumnTypes: 'off' | 'warn' | 'enforce';

  /** See AgentOptions.externalGrounds (9.72.0). Absent = door closed,
   *  byte-identical behavior. */
  readonly externalGrounds?: ExternalGroundsProvider;

  /** What a run does when a declared credential needs 3LO consent (8.6.0).
   *  Default `'pause'`. See AgentOptions.onAuthorizationRequired. */
  readonly onAuthorizationRequired: AuthorizationRequiredMode;

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

  /** Observer delivery tier (RFC-001 Block 10). `'inline'` (default) is
   *  byte-identical to pre-10 releases; `'deferred'` routes the bridge
   *  recorders + consumer attachments through footprintjs's bounded
   *  capture queue. See AgentOptions.observerDelivery. */
  readonly observerDelivery: 'inline' | 'deferred';

  /** Queue dials forwarded on every deferred attach (first attach
   *  configures the executor's single dispatcher). */
  readonly observerDeliveryOptions?: ObserverDeliveryOptions;

  /**
   * The typed ask the CURRENT run's resume answered — set by
   * `resume()` when a person's answer completed an `awaitingInput`, cleared
   * by every other run start, so a pooled agent never marks one session's
   * ask as another's re-ask. Read by the dispatch door through
   * `ToolCallsHandlerDeps.answeredAsk`. The count crosses checkpoints on the
   * awaiting-input shape itself (`repeat.count`), not here.
   */

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
  readonly memories: readonly MemoryDefinition[];

  /**
   * Optional terminal contract. Set via the builder's `.outputSchema()`.
   * When present, `agent.runTyped()` parses + validates the final
   * answer against this parser. `agent.run()` keeps returning the
   * raw string; consumers opt into typed mode explicitly.
   */
  readonly outputSchemaParser?: OutputSchemaParser<unknown>;

  /**
   * What the LOOP enforces about the output (7.26) — resolved by the builder
   * when `.outputSchema()` was given `retries` or a `'tool-forced'` strategy.
   * Undefined otherwise, and undefined is the whole of the byte-identical
   * path: no branch is mounted, the decider is the function it always was,
   * and the request is the one 7.25 sent.
   */
  readonly outputEnforcement?: ResolvedOutputEnforcement;

  /**
   * Optional 3-tier degradation for output-schema validation
   * failures. Set via the builder's `.outputFallback({...})`. When
   * present, `parseOutput()` and `runTyped()` fall through:
   *   primary → fallback → canned (in order; canned guarantees no-throw).
   */
  readonly outputFallbackCfg?: ResolvedOutputFallback<unknown>;

  /** Side-channel for `run({ continueFrom })` and `resumeOnError(...)` —
   *  when set, the seed function restores `scope.history` from this
   *  instead of starting fresh, and appends this turn's user entry when
   *  `appendsUserTurn` says so. Cleared on first read so subsequent runs
   *  start clean. */
  /** Retried request's repair state; never inherited by a new human turn. */

  /** Its sibling for the folded spans. A restored conversation that dropped
   *  them would carry summaries nobody could unpack — the evidence would be
   *  destroyed by the act of continuing, which is the one thing retention
   *  exists to prevent. Cleared on first read, exactly like the history. */

  /** Its sibling for the findings ledger (9.101.0) — the model's standings
   *  on results this process never saw, carried by the checkpoint and
   *  restored as a stored record. Cleared on first read, like the history. */

  /** The last completed run's final answer — see `checkpoint()` for why it is
   *  kept here rather than read back from the recording. Undefined after a run
   *  that failed or paused. */
  /** Last run's checkpoint owner, including explicit replay edits from a failed child stage. */
  /** Whether any run on this instance got past input admission — so a
   *  refused FIRST turn is reported as 'never-run', never as "continue from
   *  your earlier accepted checkpoint" when there is none. */

  /** The id the CONSUMER chose, or undefined when they took the default.
   *  `this.id` cannot answer that question — it is `'agent'` either way — and
   *  the stored-conversation fingerprint refuses only on ids somebody picked
   *  (see `AgentRunCheckpoint.agent`). */
  readonly explicitId?: string;

  /** The identity the caller gave the last run, or undefined when they gave
   *  none. Only an EXPLICIT identity is carried onto `checkpoint()`: the
   *  default is derived from a runId, and storing that would pin a whole
   *  conversation to the id of the one run that started it.
   *
   *  Written by BOTH run doors, before the executor exists: `run()` from the
   *  call and the continued conversation, `resume()` from the call and the
   *  paused run's own record (`agent/callerIdentity.ts · callerIdentityOf`).
   *  A resume that inherited it instead stored another person's identity on
   *  a shared agent and none on a rebuilt pooled one. */

  /** Run ids this instance minted, most recent last (bounded) — evidence that a
   *  checkpoint's `{ conversationId: '<runId>' }` is the per-run default
   *  (`agent/callerIdentity.ts`). */

  /** The self-explain evidence key of the run in flight (or served last):
   *  its session, else a host's per-request key, else undefined
   *  (`agent/servingConversation.ts`). */

  /** How long ONE tool teardown may take before the runner stops waiting.
   *  See `AgentOptions.toolTeardownTimeoutMs`. */
  readonly toolTeardownTimeoutMs: number;

  /**
   * Optional `ToolProvider` set via the builder's `.toolProvider()`.
   * When present, the Tools slot subflow consults it per iteration
   * (Block A5 follow-up) — the provider's tools land alongside any
   * tools registered statically via `.tool()` / `.tools()`. The
   * tool-call dispatcher also consults it for per-iteration execute
   * lookup so dynamic chains (`gatedTools`, `skillScopedTools`)
   * dispatch correctly when their visible-set changes mid-turn.
   */
  readonly externalToolProvider?: ToolProvider;

  /**
   * Optional rules-based reliability config (v2.11.5+). Set via the
   * builder's `.reliability({...})`. When present, every CallLLM
   * execution is wrapped in a retry/fallback/fail-fast loop driven
   * by `preCheck` and `postDecide` rules. Consumed by `buildCallLLMStage`.
   */
  readonly reliabilityConfig?: ReliabilityConfig;

  /**
   * Resolved ThinkingHandler (v2.14+). The provider's DECLARED one
   * (`thinkingHandlerFor`) UNLESS the builder explicitly set one
   * (or `null` to opt out). When undefined, the NormalizeThinking
   * sub-subflow is NOT mounted at chart build time — zero overhead
   * for non-thinking agents.
   */
  readonly thinkingHandler?: ThinkingHandler;

  /**
   * v2.14+ — request-side thinking budget. When set, every LLMRequest
   * carries `thinking: { budget }`. AnthropicProvider translates to the
   * wire format. Undefined = no thinking activation (default behavior).
   */
  readonly thinkingBudget?: number;

  /** Threaded to footprintjs `flowChart()` so every node the Agent
   *  builder creates is observed by these recorders at build time. Set
   *  from `opts.structureRecorders`; undefined when consumer didn't
   *  attach any. */
  readonly structureRecorders?: readonly import('footprintjs').StructureRecorder[];

  /** Per-COMPOSITION translator (L1b). Set from `opts.groupTranslator`;
   *  undefined when consumer didn't attach one. */
  readonly agentGroupTranslator?: import('../../../translator.js').GroupTranslator;

  /** ReAct loop mode — 'dynamic' (default, re-engineer all slots each turn,
   *  flat chart), 'classic' (engineer context once, loop→Messages only, flat
   *  chart), or 'dynamic-grouped' (dynamic semantics + LLM turn wrapped in an
   *  sf-llm-call subflow for richer Lens grouping). Set from `opts.reactMode`.
   *  See AgentOptions. */
  readonly reactMode: 'classic' | 'dynamic' | 'dynamic-grouped';

  /** The recipes `.recipe()` applied, in declaration order. Held for ONE
   *  purpose: the run manifest's `recipes` rows, so a recording can say which
   *  composition produced the agent that answered. Undefined — never `[]` — on
   *  every agent built without one, which is what keeps the manifest of an
   *  agent that uses no recipes byte-identical to the one it emitted before
   *  they existed. */
  readonly appliedRecipes?: readonly AppliedRecipe[];

  /** The DECLARED skill map (9.50.0) — nodes + edges verbatim, captured by
   *  `AgentBuilder.skillGraph()`. Filed once per run as
   *  `agentfootprint.skill.graph_declared`; undefined = no graph, or a graph
   *  that could not state its map (the event then never fires). */
  readonly skillGraphDeclared?: SkillGraphDeclaredMap;

  /** The maps kernel's plan (9.58.0) — present only when built with `.maps()`. */
  readonly mapsPlan?: import('../../../../maps/engagement/types.js').EngagementPlan;

  /** `.claims()` (9.61.0) — the declared claim contract, or undefined. */
  readonly claimContract?: readonly import('../../../../integrity/unsupported-claim/check.js').DeclaredClaim[];

  /** `AgentOptions.recordSystemPrompt` (9.50.0) — OFF by default. When true,
   *  every `stream.llm_start` carries the assembled system prompt verbatim as
   *  `systemPromptText`. */
  readonly recordSystemPromptValue: boolean;

  /** `AgentOptions.recordReceipt` (9.88.0) — ON by default. `false` declines
   *  the mint at `callLLM`; nothing else about the run changes. */
  readonly recordReceiptValue: boolean;

  readonly answerValidationConfig?: ResolvedAnswerValidation;

  readonly negativeClaimsConfig?: ResolvedNegativeClaims;

  readonly typedNegativeClaimsConfig?: ResolvedTypedNegativeClaims;

  readonly applicationAnswerValidation: boolean;
}
