/**
 * RunnerBase — shared implementation of the Runner interface.
 *
 * Pattern: Template Method (GoF). Subclasses override `buildChart()` and
 *          optionally `onBeforeRun()` / `onAfterRun()`; the base handles
 *          dispatcher, recorder attachment, custom emit, and subscription.
 * Role:    Base class for LLMCall, Agent, Sequence, Parallel, Conditional, Loop.
 * Emits:   Nothing directly — its attached recorders do.
 */

import type {
  CombinedRecorder,
  FlowChart,
  FlowChartExecutor,
  FlowchartCheckpoint,
  RedactionPolicy,
  RunOptions,
} from 'footprintjs';
import type { RunContext } from '../bridge/eventMeta.js';
import { EventDispatcher, REFUSE } from '../events/dispatcher.js';
import { bindChartStages } from '../redaction/chartBinding.js';
import {
  compositionOf,
  declarationOf,
  declareRedaction,
  redactionDeclaredBy,
} from '../redaction/declared.js';
import { policyOfCoverage, type Coverage } from '../redaction/coverage.js';
import { unionNames, type NameDeclarations } from '../redaction/names.js';
import { policyOfMarks, unionRedactionPolicies } from '../redaction/policy.js';
import {
  adoptScopeOutsideRun,
  coverageOfExecutor,
  createRunRedaction,
  outsideRunFor,
  servingAhead,
  servingOfExecutor,
  type OutsideRun,
  type RunRedaction,
} from '../redaction/runRedaction.js';
import type { EventServing } from '../redaction/served.js';
import { servableSnapshot } from './servableSnapshot.js';
import { registerRunnerLive } from './runnerLive.js';
import { redactConsentUrlForEvent } from '../identity/consent.js';
import { argumentAskReplyForEvent, isArgumentAskPause } from './agent/arguments/askMarker.js';
import { readAskComponent } from './askComponent.js';
import { pauseDemandsDecision } from './pause.js';
import { readAwaitingInput } from './inputRequest.js';
import type { MiddlewareAsk, RunnerPauseOutcome } from './pause.js';
import type { CheckInRequest } from './checkin.js';
import type {
  EventListener,
  ListenOptions,
  Unsubscribe,
  WildcardListener,
  WildcardSubscription,
} from '../events/dispatcher.js';
import type {
  AgentfootprintEvent,
  AgentfootprintEventMap,
  AgentfootprintEventType,
} from '../events/registry.js';
import type { EventMeta } from '../events/types.js';
import { CONSUMER_SCOPE_RUN_ID } from '../bridge/eventMeta.js';
import {
  attachObservabilityStrategy,
  attachCostStrategy,
  attachLiveStatusStrategy,
} from '../strategies/attach.js';
import type { StrategyHandle } from '../strategies/types.js';
import { ASYNC_DISPOSE } from '../strategies/lifecycle.js';
import {
  attachFlowchart,
  type FlowchartHandle,
  type FlowchartOptions,
} from '../recorders/observability/FlowchartRecorder.js';
import {
  attachLocalObservability,
  type LocalObservabilityHandle,
  type LocalObservabilityOptions,
} from '../recorders/observability/localObservability.js';
import type { EnableNamespace, Runner } from './runner.js';
import type { TeardownReason, ToolSessionTier } from './toolSessions.js';

let _runIdSeq = 0;

/**
 * Make a unique run id. Exported for tests; internal use normally.
 */
export function makeRunId(): string {
  return `run-${Date.now()}-${++_runIdSeq}`;
}

/**
 * Is `value` shaped like an id {@link makeRunId} mints? The recogniser lives
 * beside the minter so the format has one owner.
 *
 * Asked by `core/agent/callerIdentity.ts · callerIdentityOf`, which must tell
 * the per-run DEFAULT identity (`{ conversationId: '<runId>' }`, seed's third
 * rung) apart from an identity a caller named — the one fact a resumed run
 * cannot otherwise recover, because a flowchart checkpoint does not carry the
 * paused run's id.
 */
export function isMintedRunId(value: unknown): boolean {
  return typeof value === 'string' && /^run-\d+-\d+$/.test(value);
}

/**
 * One cancellation signal per run, for every runner. A caller may hand it to
 * the engine (`signal`, which stops the traversal) or to the stages
 * (`env.signal`, which tools and the reliability loop read). Handed only to the
 * engine, it is handed to the stages too — so a stage never takes the run's
 * own abort for a failure (the reliability loop filed it as a fail-fast, and an
 * agent inside a composition retried the cancelled call up to its cap). Every
 * runner's `run` / `resume` passes its options through here. The SAME object
 * when there is nothing to add.
 */
export function withRunSignalInEnv<T extends RunOptions>(options: T | undefined): T | undefined {
  if (options?.signal === undefined || options.env?.signal !== undefined) return options;
  return { ...options, env: { ...options.env, signal: options.signal } };
}

export abstract class RunnerBase<TIn = unknown, TOut = unknown> implements Runner<TIn, TOut> {
  protected readonly dispatcher = new EventDispatcher();
  protected readonly attachedRecorders: CombinedRecorder[] = [];

  /**
   * The most recently used FlowChartExecutor — set by subclasses in
   * `run()` so consumers can read the canonical structural snapshot
   * via `getLastSnapshot()`. Single source of structural truth: this
   * is footprintjs's snapshot, NOT a domain re-derivation.
   */
  protected lastExecutor: FlowChartExecutor | undefined;

  /**
   * Cached footprintjs FlowChart, built ONCE at construction time via
   * `initChart()`. Subsequent `getSpec()` calls return this same
   * object — reference-stable across all consumers (Lens spec memos,
   * footprintjs's OpenAPI/MCP caches, recorder-side correlation).
   *
   * Set via `initChart(builder)`, called from the subclass constructor
   * AFTER all instance fields are populated. Read via `getSpec()`.
   *
   * Why eager construction: the `StructureRecorder` contract is
   * "fires once per node at build time" — lazy construction would
   * fire each recorder every `getSpec()` / `run()` call (2N invocations
   * per run instead of N), break reference equality, and trigger
   * `_mergeStageMap` false-positive collisions on second build.
   * See `RunnerBase.initChart` for details.
   *
   * Visibility note: `private` (not `protected`) so subclasses cannot
   * bypass the `initChart()` double-init guard by writing the field
   * directly. All legitimate access goes through `getSpec()` and
   * `initChart()`.
   */
  private chart: FlowChart | undefined;

  /**
   * Returns the footprintjs snapshot from the most recent run. The snapshot is
   * the CANONICAL STRUCTURE: nodes, edges, executionTree, runtimeStageId,
   * commitLog.
   *
   * Domain consumers (Lens, Trace, dashboards) read this for shape
   * and join their own per-stage payload by `runtimeStageId`. They
   * MUST NOT re-derive structure from typed events — that's the
   * design footprintjs's CLAUDE.md Convention 1 explicitly forbids.
   *
   * `undefined` before the first `run()` has STARTED. After that it is the
   * most recent run's snapshot, including across multi-turn reuse of the same
   * runner instance.
   *
   * **Live during a run.** The executor is assigned at run start, so a caller
   * reading this from inside a run — an event listener, a tool, a recorder —
   * gets the IN-FLIGHT snapshot, partially filled, not the last completed one.
   * {@link RunnerBase.getSnapshot} is the same value under the name that says
   * so. Anything that must describe a FINISHED run has to capture at the
   * terminal flush instead of polling this.
   *
   * **Served, under a redaction policy.** When the run was covered by one
   * (`Agent.create({ redact })`, a composed member's, or one a calling tool
   * handed down), this is footprintjs's REDACTED view —
   * `getSnapshot({ redact: true })`, through `servableSnapshot`, the one owner
   * of what a run may show: `sharedState` and every subflow's state from the
   * redacted mirror, the commit log as scrubbed at write time, and no
   * `initialState` (the raw pre-run base never passed the policy, so a fold of
   * it reports `basis: 'log-only'`). Without a policy it is the snapshot
   * exactly as footprintjs builds it. The library's own logic never reads this
   * getter — what it computes on is the live run (`liveSnapshot`).
   */
  getLastSnapshot(): ReturnType<FlowChartExecutor['getSnapshot']> | undefined {
    if (this.lastExecutor === undefined) return undefined;
    const coverage = coverageOfExecutor(this.lastExecutor);
    switch (coverage.state) {
      case 'covered':
        return servableSnapshot(this.lastExecutor, coverage.policy);
      case 'declared-none':
        return servableSnapshot(this.lastExecutor, undefined);
      case 'unknown':
        // An executor no run of this runner opened: nothing says what its
        // record may show, so none of it is served — fail closed, never raw.
        return undefined;
    }
  }

  /**
   * The LIVE snapshot of the most recent run — real values, never served.
   * For the runner's own logic only (continuing a conversation, building a
   * checkpoint, decoding the run's verdict): what the agent computes on is the
   * class the redaction law never covers. Anything handed OUT goes through
   * {@link RunnerBase.getLastSnapshot}.
   */
  protected liveSnapshot(): ReturnType<FlowChartExecutor['getSnapshot']> | undefined {
    return this.lastExecutor?.getSnapshot();
  }

  /**
   * Registers this runner's LIVE taps — the real-value event path and the live
   * committed state — for the library's own mechanisms outside this class
   * (`runnerLive.ts`: a host's streamed reply, spend ledger and session store,
   * `toSSE({ format: 'text' })`). Deliberately not a method: no consumer can
   * reach the real values through a runner, so none can make them a record.
   */
  constructor() {
    // Every runner DECLARES: positively none, until a subclass declares its
    // own policy (`Agent.create({ redact })`, a composition adopting its
    // members') — never a lookup that misses (`redaction/coverage.ts`).
    declareRedaction(this, undefined);
    // Before any run opens its redaction, an event of no run (a consumer's
    // `emit`, a host's fact) is served under what this runner DECLARES — read
    // at dispatch time, since the declaration is made after this constructor.
    let declaredServing: { declaration: Coverage; serving: EventServing } | undefined;
    // A fact of a run this dispatcher holds no serving for is refused, never
    // served under another run's policy; the run-id format is ours to judge.
    this.dispatcher.useRunIdRecogniser(isMintedRunId);
    this.dispatcher.useInstanceServing(() => {
      const declaration = declarationOf(this);
      if (declaration.state === 'unknown') return REFUSE;
      if (declaredServing?.declaration !== declaration) {
        declaredServing = {
          declaration,
          serving: servingAhead(policyOfCoverage(declaration), this.redactionNames()),
        };
      }
      return declaredServing.serving;
    });
    registerRunnerLive(this, {
      onRealEvent: (listener) => this.dispatcher.onRealEvent(listener),
      liveState: () => this.lastExecutor?.getRuntime().globalStore.getState(),
      liveSnapshot: () => this.liveSnapshot(),
    });
  }

  /**
   * Open the redaction for one run — called by every runner's
   * `createExecutor`, for every run, before `new FlowChartExecutor`.
   *
   * The policy in force is this runner's declaration joined with `handedDown`
   * (a policy the caller added for this run — `AgentRunOptions.redact`). The
   * returned object supplies the executor's scope factory (so every stage's
   * events are served at their source, `src/redaction/runRedaction.ts`) and
   * hands the policy to footprintjs (`applyTo`). The dispatcher serves the
   * run's direct facts by the same rule from here on.
   */
  protected openRunRedaction(
    handedDown: RedactionPolicy | undefined,
    getRunContext: () => RunContext,
  ): RunRedaction {
    const policy = unionRedactionPolicies(redactionDeclaredBy(this), handedDown);
    const run = createRunRedaction({
      policy,
      dispatcher: this.dispatcher,
      getRunContext,
      names: this.redactionNames(),
    });
    // Under the run's own id too: a fact it dispatches after the next run
    // opened is still served under this run's policy.
    this.dispatcher.useServing(run.serving, getRunContext().runId);
    return run;
  }

  /**
   * The names this runner DECLARED at build (`redaction/names.ts`) — its own
   * id and name, and what each runner adds (an agent's tools, their
   * arguments, its skills, its configuration; a composition's members'). A
   * `declaredName` field of an event is served as structure only when it
   * holds one of them (`events/content.ts`); every run starts from these and
   * adds what it registers as it composes.
   */
  protected redactionNames(): NameDeclarations {
    const self = this as unknown as { readonly id?: unknown; readonly name?: unknown };
    // A composition's own labels for its members (branch ids, step names),
    // and every name each member declared — they run in its executor.
    const { members, labels } = compositionOf(this);
    return unionNames(
      {
        config: [self.id, self.name, ...labels].filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        ),
      },
      ...members.map((member) => RunnerBase.namesOf(member)),
    );
  }

  /** The names `runner` declared — a member of a composition; none for one that is not a runner of this library. */
  protected static namesOf(runner: unknown): NameDeclarations {
    return runner instanceof RunnerBase ? runner.redactionNames() : {};
  }

  /**
   * Alias for `getLastSnapshot()` that mirrors `FlowChartExecutor.getSnapshot()`
   * so consumers (lens, playground, ExplainableShell) can read the live or
   * just-completed snapshot through the same method name they'd use on a
   * footprintjs executor — without having to know whether they're holding
   * an agentfootprint Runner or a raw executor.
   *
   * During an active run, returns the in-progress snapshot (commit log +
   * execution tree built incrementally as stages execute). Between runs,
   * returns the last completed run's snapshot. Undefined before any run has
   * started. Served exactly as `getLastSnapshot()` is: under the run's
   * redaction policy, the placeholder where a selected value was.
   */
  getSnapshot(): ReturnType<FlowChartExecutor['getSnapshot']> | undefined {
    return this.getLastSnapshot();
  }

  /**
   * How many commits the run has written so far — footprintjs's
   * `executor.getCommitCount()`, forwarded.
   *
   * This is the run's TIME AXIS. One commit lands per executed stage, in
   * order, so the count sampled at some moment is that moment's position
   * in the run. Observers stamp it to say WHEN they fired: it is what
   * `boundaryRecorder({ getCommitCount })` records on every boundary, and
   * the only reason a step strip can be rebuilt from a stored recording
   * later. Sample it live, at the moment of the event — a number read
   * once and captured is a number about the wrong instant.
   *
   * `0` before the first run, and during a run it climbs; between runs it
   * is the last run's total. Cumulative across `resume()` on the same
   * executor, and it counts the whole run — a subflow's own commits are
   * kept out of the run-level log by footprintjs, so this is the parent
   * timeline, not a sum of every nested one.
   */
  getCommitCount(): number {
    return this.lastExecutor?.getCommitCount() ?? 0;
  }

  // ─── Subclass hooks ────────────────────────────────────────────

  /**
   * Return the footprintjs FlowChart for this runner — the canonical
   * design-time blueprint. STABLE REFERENCE across calls (`getSpec()
   * === getSpec()`). Set once at construction via `initChart()`.
   *
   * Pairs with the run-time getters (`getLastSnapshot`,
   * `getCommitCount`) and matches `ExplainableShell.spec` +
   * `specToReactFlow(spec, ...)` consumer conventions. Its
   * `buildTimeStructure` field is what a viewer draws — save it with the
   * snapshot when storing a run, since no snapshot carries it.
   *
   * DO NOT OVERRIDE in subclasses — the reference-identity contract
   * (Lens / OpenAPI / MCP caches memo on this returning the same
   * object) depends on the inherited body returning `this.chart`
   * directly. To customise build behaviour, override `buildChart()`
   * instead; this getter must remain a thin cache-read.
   */
  getSpec(): FlowChart {
    if (this.chart === undefined) {
      throw new Error(
        `${this.constructor.name}: chart not initialized — the subclass must call \`this.initChart(() => this.buildChart())\` in its constructor before any \`getSpec()\` / \`run()\`.`,
      );
    }
    return this.chart;
  }

  /**
   * Cached `getUIGroup()` output. Computed lazily on first read so the
   * subclass constructor doesn't need to run the translator before all
   * its members exist (e.g., Parallel builds its branches list mid-
   * construction). After first invocation, subsequent calls return the
   * same reference — reference-stable, matches the `getSpec()` contract.
   *
   * `null` (not `undefined`) is the explicit "computed; result was
   * undefined" marker so we can distinguish from "not yet computed."
   * Consumers see `undefined` when no translator was attached.
   */
  private uiGroupCache: { readonly value: unknown } | undefined;

  /**
   * Return the consumer-shaped UI group for this composition — produced
   * by invoking the consumer's `groupTranslator` (if attached) with this
   * runner's `GroupMetadata`. Returns `undefined` when no translator was
   * attached.
   *
   * STABLE REFERENCE across calls. Computed on first access and cached;
   * subsequent calls return the same value. Pairs with `getSpec()` —
   * library shape on one side, consumer-shaped UI on the other.
   *
   * Subclasses MUST override `buildUIGroupMetadata()` (the next hook) to
   * supply the `GroupMetadata` for their composition kind. This method
   * (the public surface) is `final`-by-convention — do not override.
   */
  getUIGroup<T = unknown>(): T | undefined {
    if (this.uiGroupCache !== undefined) {
      return this.uiGroupCache.value as T | undefined;
    }
    const translator = this.getGroupTranslator();
    if (translator === undefined) {
      this.uiGroupCache = { value: undefined };
      return undefined;
    }
    const metadata = this.buildUIGroupMetadata();
    if (metadata === undefined) {
      this.uiGroupCache = { value: undefined };
      return undefined;
    }
    // SEAL THE CACHE BEFORE INVOKING THE TRANSLATOR so a throwing
    // translator can't be re-invoked on the next `getUIGroup()` call.
    // The `GroupTranslator` JSDoc guarantees "Runs ONCE per composition"
    // — that invariant must hold for throwing translators too, otherwise
    // a translator with side effects (telemetry, counters) would
    // double-count on every re-read after a throw. Re-throws the same
    // error so the caller still sees the failure on FIRST call; second
    // call returns `undefined` (the sealed value).
    this.uiGroupCache = { value: undefined };
    const value = translator(metadata) as unknown;
    this.uiGroupCache = { value };
    return value as T;
  }

  /**
   * Subclass hook — returns the consumer's translator if one was
   * provided at construction time. Default: no translator (returns
   * undefined). Each composition overrides to surface its own
   * `opts.groupTranslator`.
   */
  protected getGroupTranslator(): import('./translator.js').GroupTranslator | undefined {
    return undefined;
  }

  /**
   * Translate this runner's group metadata with a CALLER-SUPPLIED
   * translator that overrides the runner's own default. Used by
   * parent compositions to apply per-method translator overrides.
   * See the `Runner.getUIGroupWith` JSDoc for the contract.
   */
  getUIGroupWith<T = unknown>(override: import('./translator.js').GroupTranslator): T | undefined {
    const metadata = this.buildUIGroupMetadata();
    if (metadata === undefined) return undefined;
    return override(metadata) as T;
  }

  /**
   * Subclass hook — returns the `GroupMetadata` for this composition.
   * Default: undefined, meaning "no group translation for this runner
   * kind." Compositions override to supply their members + kind. Called
   * AT MOST ONCE per runner (result is cached by `getUIGroup()`).
   */
  protected buildUIGroupMetadata(): import('./translator.js').GroupMetadata | undefined {
    return undefined;
  }

  /**
   * Build + cache the runner's `FlowChart` exactly once. Called by the
   * subclass constructor AFTER all instance fields are set, so the
   * builder lambda can close over them safely.
   *
   * Throws if called twice on the same instance — the chart is meant
   * to be immutable post-construction. Each `run()` reuses the same
   * chart in a fresh `FlowChartExecutor`.
   *
   * Implementation invariant (per footprintjs inventor review):
   * each attached `StructureRecorder` fires exactly N times per
   * construction (N = node count). Two `getSpec()` calls return the
   * same `FlowChart` object reference. `_mergeStageMap` collision
   * guards never see false-positives because each child runner's
   * stage functions are created once and reused.
   */
  protected initChart(builder: () => FlowChart): void {
    if (this.chart !== undefined) {
      throw new Error(
        `${this.constructor.name}: initChart() called twice — the chart is built once at construction and is immutable.`,
      );
    }
    this.chart = builder();
    // A stage that runs outside this runner's runs (its chart mounted into an
    // executor the app built) serves its events under what this runner
    // declares — its policy, or positively none — bound to THIS runner at
    // build, by identity, and held by it: no registry another runner's stage
    // could read, and never left untied (an untied scope reads as unknown).
    let outside: OutsideRun | undefined;
    bindChartStages(this.chart, (scope) => {
      const declaration = declarationOf(this);
      if (outside?.declaration !== declaration) {
        outside = outsideRunFor(declaration, this.redactionNames());
      }
      adoptScopeOutsideRun(scope, outside);
    });
  }

  /**
   * Execute the runner. Subclass may override for specialized input
   * mapping, but default invokes getSpec() + FlowChartExecutor.
   */
  abstract run(input: TIn | string, options?: RunOptions): Promise<TOut | RunnerPauseOutcome>;

  /**
   * Resume a paused run from its checkpoint. Default behavior: rebuild the
   * chart, wire the same core recorders + consumer recorders, call
   * `executor.resume(checkpoint, input)`, and emit `pause.resume` before
   * returning. Subclass overrides only if it needs specialized behavior.
   */
  abstract resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<TOut | RunnerPauseOutcome>;

  // ─── Pause/resume utilities (shared by every concrete runner) ───

  /**
   * Inspect an executor result. On pause, emits `pause.request` and returns
   * a `RunnerPauseOutcome`. Otherwise returns `undefined` and the subclass
   * continues its normal result-shape handling (string vs BranchResults vs
   * Error).
   *
   * Subclasses call this BEFORE their own type checks, so pause is never
   * misinterpreted as "unexpected result shape".
   */
  protected detectPause(
    executor: FlowChartExecutor,
    result: unknown,
  ): RunnerPauseOutcome | undefined {
    if (!executor.isPaused()) return undefined;
    const checkpoint = executor.getCheckpoint();
    if (checkpoint === undefined) return undefined;

    const pauseData =
      checkpoint.pauseData !== undefined
        ? checkpoint.pauseData
        : typeof result === 'object' && result !== null && 'paused' in result
        ? (result as { pauseData?: unknown }).pauseData
        : undefined;

    this.emitPauseRequest(checkpoint, pauseData, servingOfExecutor(executor));

    // A check-in pause carries its typed request under `pauseData.checkIn` and a
    // middleware ask carries its question under `pauseData.ask` (the dispatch
    // handler tags them there before pausing). Surface both as first-class
    // fields so consumers can `isCheckInPause(outcome)` / `isAskPause(outcome)`
    // and read the evidence pack or the question without reaching into the raw
    // payload. A plain `askHuman` pause has neither key → both stay absent.
    //
    // 8.13.0 — WHICH key is present is read by `pauseDemandsDecision`, the one
    // reader of that shape, shared with `Agent.resume`'s refusal. The surface a
    // consumer is told about and the surface the library enforces cannot drift.
    const gate = pauseDemandsDecision(pauseData);
    const checkIn =
      gate?.kind === 'checkIn' ? (pauseData as { checkIn?: CheckInRequest }).checkIn : undefined;
    const ask = gate?.kind === 'ask' ? (pauseData as { ask?: MiddlewareAsk }).ask : undefined;
    const awaitingInput = gate === undefined ? readAwaitingInput(pauseData) : undefined;

    return {
      paused: true,
      checkpoint,
      pauseData,
      ...(checkIn && { checkIn }),
      ...(ask && { ask }),
      ...(awaitingInput && { awaitingInput }),
    };
  }

  /**
   * Emit `agentfootprint.pause.request` through the dispatcher. Called by
   * `detectPause()`. Subclasses should not emit this directly. Served under
   * the serving of the run that paused (`runServing`, from its executor) —
   * never the run opened last on this instance.
   */
  private emitPauseRequest(
    checkpoint: FlowchartCheckpoint,
    pauseData: unknown,
    runServing: EventServing | undefined,
  ): void {
    const meta = this.minimalMeta();
    const reasonFromData =
      typeof pauseData === 'object' && pauseData !== null && 'reason' in pauseData
        ? String((pauseData as { reason: unknown }).reason)
        : 'stage requested pause';
    const event = {
      type: 'agentfootprint.pause.request',
      payload: {
        reason: reasonFromData,
        // This mirrors the WHOLE `pauseData` onto the wire, which is right for
        // a check-in's evidence pack and wrong for a bearer capability. A 3LO
        // consent URL is withheld here BY NAME (8.6.0) — the same discipline
        // the audit adapter's BOUND_FIELDS applies to `tool_end.result`. Every
        // other pause shape passes through by reference, unchanged.
        questionPayload:
          typeof pauseData === 'object' && pauseData !== null
            ? redactConsentUrlForEvent(pauseData as Readonly<Record<string, unknown>>)
            : { data: pauseData },
      },
      meta: {
        ...meta,
        runtimeStageId: `${checkpoint.pausedStageId}#paused`,
        subflowPath: checkpoint.subflowPath,
      },
    } as const;
    this.dispatcher.dispatchForRun(event as unknown as AgentfootprintEvent, runServing);
  }

  /**
   * Emit `agentfootprint.pause.resume` through the dispatcher. Called from
   * concrete runners' `resume()` BEFORE invoking `executor.resume()` — so
   * before the leg's run opens its redaction. The payload is the person's
   * reply, a record like every event: it is served under the policy the
   * resumed leg is covered by (this runner's declaration joined with
   * `handedDown`, the caller's per-run policy, and the names the paused leg
   * kept out — the checkpoint's marks), installed here first — otherwise a
   * fresh instance, a later process or another pool lane would dispatch it
   * unserved (`runRedaction.ts` · `servingAhead`).
   */
  protected emitPauseResume(
    checkpoint: FlowchartCheckpoint,
    input: unknown,
    handedDown?: RedactionPolicy,
  ): RedactionPolicy | undefined {
    // The resumed leg's own policy beside this runner's declaration: what the
    // caller hands it, joined with the names the paused leg kept out (the
    // checkpoint's marks) — returned for the runner to hand THIS leg's
    // executor (`openRunRedaction`), so nothing per-run is kept on the instance.
    const resumeLeg = unionRedactionPolicies(handedDown, policyOfMarks(checkpoint.redactionMarks));
    this.dispatcher.useServing(
      servingAhead(
        unionRedactionPolicies(redactionDeclaredBy(this), resumeLeg),
        this.redactionNames(),
      ),
    );
    const meta = this.minimalMeta();
    const pausedDurationMs = Date.now() - checkpoint.pausedAt;
    // Which registered component the paused ask nominated to collect this
    // answer (9.24.0) — read from the checkpoint's own pause payload
    // (`readAskComponent` knows every home the three pause kinds use), so the
    // resume record says which surface the person answered through. Absent for
    // every prose-only ask, and the payload is byte-identical there.
    const answeredVia = readAskComponent(checkpoint.pauseData)?.componentId;
    this.dispatcher.dispatch({
      type: 'agentfootprint.pause.resume',
      payload: {
        // The inputs layer's OWN ask (honesty layer 2): its answer fills
        // arguments a tool's view may hide, and such a value rides no event —
        // so the reply's shape travels (request id, field ids) and every
        // answered value reads 'REDACTED' (`askMarker.ts` ·
        // `argumentAskReplyForEvent`). The `answered` rows carry what each
        // tool's view allows. Every other pause kind: the reply, unchanged.
        resumeInput: isArgumentAskPause(checkpoint.pauseData)
          ? argumentAskReplyForEvent(input)
          : typeof input === 'object' && input !== null
          ? (input as Readonly<Record<string, unknown>>)
          : { input },
        pausedDurationMs,
        ...(answeredVia !== undefined && { componentId: answeredVia }),
      },
      meta: {
        ...meta,
        runtimeStageId: `${checkpoint.pausedStageId}#resumed`,
        subflowPath: checkpoint.subflowPath,
      },
    });
    return resumeLeg;
  }

  // ─── Subscription API (delegates to dispatcher) ────────────────

  on<K extends AgentfootprintEventType>(
    type: K,
    listener: EventListener<K>,
    options?: ListenOptions,
  ): Unsubscribe;
  on(type: WildcardSubscription, listener: WildcardListener, options?: ListenOptions): Unsubscribe;
  on(
    type: string,
    listener: (event: AgentfootprintEvent) => void,
    options?: ListenOptions,
  ): Unsubscribe {
    // Cast via unknown — the public overloads on EventDispatcher restrict
    // `type` to either a specific key or a known wildcard; our public
    // signature is equivalent but TS can't prove that through the union.
    return (
      this.dispatcher.on as unknown as (
        type: string,
        listener: (event: AgentfootprintEvent) => void,
        options?: ListenOptions,
      ) => Unsubscribe
    )(type, listener, options);
  }

  off<K extends AgentfootprintEventType>(type: K, listener: EventListener<K>): void;
  off(type: WildcardSubscription, listener: WildcardListener): void;
  off(type: string, listener: (event: AgentfootprintEvent) => void): void {
    (
      this.dispatcher.off as unknown as (
        type: string,
        listener: (event: AgentfootprintEvent) => void,
      ) => void
    )(type, listener);
  }

  once<K extends AgentfootprintEventType>(
    type: K,
    listener: EventListener<K>,
    options?: Omit<ListenOptions, 'once'>,
  ): Unsubscribe;
  once(
    type: WildcardSubscription,
    listener: WildcardListener,
    options?: Omit<ListenOptions, 'once'>,
  ): Unsubscribe;
  once(
    type: string,
    listener: (event: AgentfootprintEvent) => void,
    options?: Omit<ListenOptions, 'once'>,
  ): Unsubscribe {
    return (
      this.dispatcher.once as unknown as (
        type: string,
        listener: (event: AgentfootprintEvent) => void,
        options?: Omit<ListenOptions, 'once'>,
      ) => Unsubscribe
    )(type, listener, options);
  }

  /**
   * Lifecycle escape hatch — drop EVERY event listener on this runner in
   * one call (typed, domain-wildcard, and `'*'`). Delegates to
   * `EventDispatcher.removeAllListeners()`.
   *
   * For long-lived runners on servers: when you can't thread an
   * AbortSignal or keep every Unsubscribe handle, call this between
   * requests to guarantee zero residual subscriptions. Note it also
   * removes listeners wired by `enable.*` strategies — re-enable after
   * calling if you still want them. Does NOT touch attached recorders
   * (see `attach()` — recorders have their own Unsubscribe).
   */
  removeAllListeners(): void {
    this.dispatcher.removeAllListeners();
  }

  /**
   * Diagnostic — how many event listeners this runner currently retains.
   * No argument = total across all buckets (the leak-detection number);
   * with a subscription key = that bucket only. Delegates to
   * `EventDispatcher.listenerCount()`.
   */
  listenerCount(type?: AgentfootprintEventType | WildcardSubscription): number {
    return this.dispatcher.listenerCount(type);
  }

  // ─── Recorder attach ───────────────────────────────────────────

  /**
   * Attach a footprintjs CombinedRecorder to observe every subsequent run.
   *
   * LIFECYCLE CONTRACT (who owns cleanup):
   * - Attached recorders live for the RUNNER's lifetime, not a run's.
   *   NOTHING auto-expires per-run — a recorder attached once observes
   *   every later `run()` until you call the returned Unsubscribe.
   * - The CALLER owns cleanup. Keep the Unsubscribe and call it when the
   *   observer's life ends (request scope, UI unmount, test teardown).
   * - Event listeners (`on()` / `once()`) follow the same rule, with two
   *   extra outs: pass `{ signal }` for AbortSignal auto-cleanup, or call
   *   `removeAllListeners()` to bulk-drop listeners (listeners ONLY —
   *   recorders are not affected).
   * - `once()` listeners are the only self-expiring subscription.
   *
   * attach() is NOT idempotent: every call pushes another entry. (At run
   * time footprintjs's executor dedupes recorders by ID, so same-ID
   * duplicates won't double-fire — but the runner-side array still
   * grows.) Attaching in a per-run loop without detaching is the classic
   * server leak; attach once, or detach per-run.
   *
   * WHEN it starts observing: the NEXT run. Recorders are handed to the
   * executor when the executor is built, at run start, so one attached WHILE
   * a run is in flight sees nothing of that run and everything of the one
   * after — it is not dropped, it is early. Between runs (or before the
   * first) is the ordinary case and works exactly as it reads. Event
   * listeners are the opposite: `on()` takes effect immediately, but only for
   * events emitted after it, so a listener added mid-run sees the rest of
   * that run and none of its beginning.
   */
  attach(recorder: CombinedRecorder): Unsubscribe {
    this.attachedRecorders.push(recorder);
    return () => {
      const idx = this.attachedRecorders.indexOf(recorder);
      if (idx >= 0) this.attachedRecorders.splice(idx, 1);
    };
  }

  // ─── Enable namespace (Tier 3 observability features) ─────────

  /**
   * Every live `enable.*` strategy handle on this runner — what
   * `shutdown()` drains. A handle leaves the set as soon as it is
   * unsubscribed or stopped, so a server that enables per request and
   * unsubscribes per request does not grow one.
   */
  private readonly liveStrategyHandles = new Set<StrategyHandle>();

  /** In-flight `shutdown()`, so concurrent callers share one drain. Cleared
   *  when it settles — the runner stays usable, so a later shutdown runs
   *  again rather than resolving against a stale promise. */
  private shutdownInFlight: Promise<void> | undefined;

  /**
   * Track a strategy handle for `shutdown()` and hand back a handle that
   * forgets itself once the consumer releases it.
   */
  private trackStrategyHandle(handle: StrategyHandle): StrategyHandle {
    const live = this.liveStrategyHandles;
    live.add(handle);
    const tracked = Object.assign(
      (): void => {
        handle();
        live.delete(handle);
      },
      {
        flush: (): Promise<void> => handle.flush(),
        stop: (): void => {
          handle.stop();
          live.delete(handle);
        },
        [ASYNC_DISPOSE]: async (): Promise<void> => {
          // Read the method back through the SAME key it was stored under.
          // `Symbol.asyncDispose` literally would miss it on an engine old
          // enough to need the fallback key — the one place these two
          // spellings could drift apart.
          const dispose = (handle as unknown as Record<symbol, (() => Promise<void>) | undefined>)[
            ASYNC_DISPOSE
          ];
          await dispose?.();
          live.delete(handle);
        },
      },
    );
    // Same cast as `makeStrategyHandle`: a computed symbol key reads as an
    // index signature, not the well-known member `AsyncDisposable` names.
    return tracked as unknown as StrategyHandle;
  }

  /**
   * Drain and release what was enabled on this runner.
   *
   * **The agent itself remains usable afterwards; `shutdown()` drains and
   * releases what was enabled on it.** Nothing about the runner is destroyed:
   * `run()` still works, listeners still fire, and enabling telemetry again
   * gives you a fresh, live handle.
   *
   * The order is the part worth having in one place:
   *
   *   1. every handle FLUSHES first — including the events still queued on a
   *      `detach` driver, which have not reached the strategy yet;
   *   2. only then does anything stop, so a strategy shared by two handles is
   *      fully drained before either releases it;
   *   3. a strategy is stopped only once nothing is still subscribed to it,
   *      and at most once ever (see `strategies/lifecycle.ts`).
   *
   * @param options.stop - Default `true`. Pass `false` to drain WITHOUT
   *   releasing — what a host does when it is shutting down but does not own
   *   the agent it was handed (`standingAgent`'s default `shutdown: 'flush'`).
   *
   * @example Graceful exit for a script
   *   const telemetry = agent.enable.observability({ strategy: cloudwatch });
   *   const answer = await agent.run({ message: 'hi' });
   *   await agent.shutdown();
   */
  async shutdown(options: { readonly stop?: boolean } = {}): Promise<void> {
    if (this.shutdownInFlight) return this.shutdownInFlight;
    const shouldStop = options.stop ?? true;
    const handles = [...this.liveStrategyHandles];
    this.shutdownInFlight = (async () => {
      // Flush everything before stopping anything — a strategy two handles
      // share must not be stopped while the other still has data to ship.
      await Promise.allSettled(handles.map((handle) => handle.flush()));
      // TOOL SESSIONS CLOSE ON EITHER SETTING (9.7.0) — including
      // `{ stop: false }`, and this is a deliberate asymmetry worth reading.
      //
      // `stop` governs BORROWED strategies: a host that is shutting down but
      // does not own the agent it was handed drains without releasing what the
      // caller still has. A tool session is not borrowed. THIS runtime opened
      // it, on behalf of runs it executed, and nobody else holds a handle to
      // close it — so `{ stop: false }` leaving it open would not be politeness,
      // it would be a leaked sandbox on `standingAgent`'s DEFAULT path.
      //
      // Nothing live is cut: by the time a composer reaches here its host is
      // closed and in-flight runs have finished. And it stays true to
      // "the agent itself remains usable afterwards" — the next run opens a
      // fresh session, exactly as the first one did.
      await this.toolSessionTier?.fireShutdown();
      if (!shouldStop) return;
      for (const handle of handles) {
        handle.stop();
        this.liveStrategyHandles.delete(handle);
      }
    })().finally(() => {
      this.shutdownInFlight = undefined;
    });
    return this.shutdownInFlight;
  }

  // ─── Tool sessions (9.7.0) ─────────────────────────────────────

  /**
   * The teardown tier for tools that hold sessions, built on FIRST
   * registration and `undefined` until then.
   *
   * Only a runner that dispatches tools ever sets it — today that is `Agent`.
   * A `Sequence` or a `Loop` has no tool-dispatch loop, so its tier stays
   * absent and every terminal here is one `undefined` check.
   *
   * @internal
   */
  protected toolSessionTier: ToolSessionTier | undefined;

  /**
   * End the tool sessions held for one hosting session.
   * Pass `{ scope: 'run', sessionId }` to terminate only its paused turn's
   * resources, such as after an explicit input cancellation. Session-scoped
   * resources and other conversations remain open.
   *
   * **The mechanism is the library's; the TIMING is yours.** Nothing in this
   * package can know when a request/reply session is over — a `HostRequest`
   * carries a `sessionId` and no end, `SessionLifecycle` is `hydrate`/`persist`
   * by design (a TTL, a scan or a delete is the STORE's own API, not a demand
   * this port makes of every store that will ever implement it), and AWS itself
   * does not tell you: an idle timeout is the reality. Guessing a boundary here
   * would tear down a live sandbox mid-conversation.
   *
   * So the composition root, which already owns the shape of the process, says
   * when — the same doctrine that stops `shutdownOn` from grabbing signals by
   * default. On the conversation door that is one line:
   *
   * ```ts
   * conversation.onClose(() => void agent.closeToolSessions({ sessionId }));
   * ```
   *
   * A request/reply deployment that knows its own boundary — a logout, a job
   * finishing, a cart abandoned — calls the same method.
   *
   * Never calling it is survivable, not silent: sessions idle out on the tier's
   * lazy sweep, a bounded live count evicts the coldest, and `shutdown()` takes
   * whatever is left.
   *
   * @returns how many cleanups ran. `0` when this runner holds none — a
   *   composition, or an agent whose tools never opened anything.
   *
   * @example
   *   host.onSessionEnd(async (sessionId) => {
   *     const closed = await agent.closeToolSessions({ sessionId });
   *     log.info({ sessionId, closed }, 'tool sessions released');
   *   });
   */
  async closeToolSessions(
    options:
      | {
          readonly scope?: 'session';
          readonly sessionId?: string;
          readonly reason?: TeardownReason;
        }
      | { readonly scope: 'run'; readonly sessionId: string } = {},
  ): Promise<number> {
    if (options.scope === 'run' && (!options.sessionId || typeof options.sessionId !== 'string'))
      throw new TypeError('Closing run resources requires an explicit sessionId.');
    if (!this.toolSessionTier) return 0;
    if (options.scope === 'run') return this.toolSessionTier.fireSessionRuns(options.sessionId);
    return this.toolSessionTier.fireSession(options.sessionId, options.reason ?? 'session-end');
  }

  readonly enable: EnableNamespace = {
    flowchart: (opts?: FlowchartOptions): FlowchartHandle =>
      // Hand the recorder's attach(), the dispatcher AND the commit
      // count out as narrow capabilities — no reference to `this`, no
      // coupling to the runner class tree. attachFlowchart wires a
      // TopologyRecorder via the attach path AND subscribes to the event
      // dispatcher for ReAct step transitions (stream.llm_* /
      // stream.tool_*). The commit count is the third: without it every
      // boundary is stamped at index 0 and the recording's step strip
      // cannot be rebuilt — silently, since the events look complete.
      attachFlowchart(
        (r) => this.attach(r),
        this.dispatcher,
        opts,
        () => this.getCommitCount(),
      ),
    localObservability: (opts?: LocalObservabilityOptions): LocalObservabilityHandle =>
      attachLocalObservability((r) => this.attach(r), this.dispatcher, opts, Date.now, {
        getStructure: () => {
          // The serialized STATIC chart — lets the offline Trace rebuild the
          // flowchart (Replay Option A). Captured lazily; spec is reference-stable.
          const spec = this.getSpec() as { buildTimeStructure?: unknown };
          return spec.buildTimeStructure;
        },
        getSnapshot: () => this.getLastSnapshot(),
        getCommitCount: () => this.getCommitCount(),
        redactedByPolicy: () => {
          if (this.lastExecutor === undefined) return false;
          // Unknown reads as covered: a label never claims less than the record may hold.
          return coverageOfExecutor(this.lastExecutor).state !== 'declared-none';
        },
      }),
    // v2.8 grouped strategy enablers — see
    // `docs/inspiration/strategy-everywhere.md`.
    // Each returns a handle: the same `Unsubscribe` function as before, now
    // carrying `flush()` / `stop()` (and `await using`). The runner keeps a
    // reference so `shutdown()` can drain them all in one call.
    observability: (opts) =>
      this.trackStrategyHandle(attachObservabilityStrategy(this.dispatcher, opts)),
    cost: (opts) => this.trackStrategyHandle(attachCostStrategy(this.dispatcher, opts)),
    liveStatus: (opts) => this.trackStrategyHandle(attachLiveStatusStrategy(this.dispatcher, opts)),
  };

  // ─── Consumer custom emit ──────────────────────────────────────

  /**
   * Emit a consumer-defined custom event.
   *
   * If `name` matches a registered event type, this routes exactly like a
   * library-emitted event (via the typed EventMap). Otherwise it flows
   * through to wildcard listeners (`'*'`) as an opaque CustomEvent with
   * minimal meta. Library events remain reserved under `agentfootprint.*`.
   */
  emit(name: string, payload: Record<string, unknown>): void {
    if (!this.dispatcher.hasListenersFor(name as AgentfootprintEventType)) return;
    const meta: EventMeta = this.minimalMeta();
    const event = {
      type: name,
      payload,
      meta,
    } as unknown as AgentfootprintEventMap[AgentfootprintEventType];
    this.dispatcher.dispatch(event);
  }

  /**
   * Emit a library event on behalf of one hosting session — the hosting door's
   * own facts (an artifact a screen redeemed, one a host filed for a turn, a
   * hand-over that failed) — attributed to the session it was produced for
   * and, when there was one, the run.
   *
   * The meta is `emit`'s consumer-scope meta plus `sessionId`, and `runId` when
   * the fact was produced FOR a run (a host's filing names the turn's run,
   * captured when its binding was created). Those stamps are what
   * `bridge/eventMeta.ts · eventBelongsToRun` reads, so a collector that keeps
   * ONE run's events (the run's recording, the self-explain evidence) leaves
   * out a fact produced for another session or another run. Delivery is
   * unchanged: every listener still receives it.
   *
   * @internal — the hosting door's; consumers emit through {@link emit}.
   */
  emitAttributed(
    name: string,
    payload: Record<string, unknown>,
    attribution: { readonly sessionId: string; readonly runId?: string },
  ): void {
    if (!this.dispatcher.hasListenersFor(name as AgentfootprintEventType)) return;
    const meta: EventMeta = {
      ...this.minimalMeta(),
      ...(attribution.runId !== undefined && { runId: attribution.runId }),
      sessionId: attribution.sessionId,
    };
    this.dispatcher.dispatch({
      type: name,
      payload,
      meta,
    } as unknown as AgentfootprintEventMap[AgentfootprintEventType]);
  }

  // ─── Internals exposed to subclasses ───────────────────────────

  /**
   * Build a minimal EventMeta for a consumer-level emit OUTSIDE a stage
   * context. Real stage code uses `buildEventMeta` with a TraversalContext.
   */
  protected minimalMeta(): EventMeta {
    const now = Date.now();
    return {
      wallClockMs: now,
      runOffsetMs: 0,
      runtimeStageId: 'consumer-emit#0',
      subflowPath: [],
      compositionPath: this.compositionPath(),
      runId: CONSUMER_SCOPE_RUN_ID,
    };
  }

  /**
   * Composition ancestry for this runner. Subclass may override to append
   * its own identity (e.g. `'Sequence:bot'`).
   */
  protected compositionPath(): readonly string[] {
    return [];
  }

  /**
   * Provide access to the internal dispatcher for internal recorders.
   * NOT part of the public Runner contract — internal recorders (e.g.
   * ContextRecorder) receive this at construction.
   */
  protected getDispatcher(): EventDispatcher {
    return this.dispatcher;
  }
}
