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
  RunOptions,
} from 'footprintjs';
import { EventDispatcher } from '../events/dispatcher.js';
import type { RunnerPauseOutcome } from './pause.js';
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
import {
  attachObservabilityStrategy,
  attachCostStrategy,
  attachLiveStatusStrategy,
} from '../strategies/attach.js';
import {
  attachFlowchart,
  type FlowchartHandle,
  type FlowchartOptions,
} from '../recorders/observability/FlowchartRecorder.js';
import type { EnableNamespace, Runner } from './runner.js';

let _runIdSeq = 0;

/**
 * Make a unique run id. Exported for tests; internal use normally.
 */
export function makeRunId(): string {
  return `run-${Date.now()}-${++_runIdSeq}`;
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
   * Returns the footprintjs snapshot from the most recent run (or
   * undefined if no run has completed). The snapshot is the CANONICAL
   * STRUCTURE: nodes, edges, executionTree, runtimeStageId, commitLog.
   *
   * Domain consumers (Lens, Trace, dashboards) read this for shape
   * and join their own per-stage payload by `runtimeStageId`. They
   * MUST NOT re-derive structure from typed events — that's the
   * design footprintjs's CLAUDE.md Convention 1 explicitly forbids.
   *
   * Returns `undefined` before the first `run()` completes. After,
   * always returns the snapshot of the most recent run (including
   * across multi-turn reuse of the same runner instance).
   */
  getLastSnapshot(): ReturnType<FlowChartExecutor['getSnapshot']> | undefined {
    return this.lastExecutor?.getSnapshot();
  }

  /**
   * Alias for `getLastSnapshot()` that mirrors `FlowChartExecutor.getSnapshot()`
   * so consumers (lens, playground, ExplainableShell) can read the live or
   * just-completed snapshot through the same method name they'd use on a
   * footprintjs executor — without having to know whether they're holding
   * an agentfootprint Runner or a raw executor.
   *
   * During an active run, returns the live snapshot (commit log + execution
   * tree built incrementally as stages execute). Between runs, returns the
   * last completed run's snapshot. Undefined before any run has started.
   */
  getSnapshot(): ReturnType<FlowChartExecutor['getSnapshot']> | undefined {
    return this.getLastSnapshot();
  }

  // ─── Subclass hooks ────────────────────────────────────────────

  /**
   * Return the footprintjs FlowChart for this runner — the canonical
   * design-time blueprint. STABLE REFERENCE across calls (`getSpec()
   * === getSpec()`). Set once at construction via `initChart()`.
   *
   * Pairs with the run-time getters (`getLastSnapshot`,
   * `getCommitCount`) and matches `ExplainableShell.spec` +
   * `specToReactFlow(spec, ...)` consumer conventions.
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
  }

  /**
   * Execute the runner. Subclass may override for specialized input
   * mapping, but default invokes getSpec() + FlowChartExecutor.
   */
  abstract run(input: TIn, options?: RunOptions): Promise<TOut | RunnerPauseOutcome>;

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

    this.emitPauseRequest(checkpoint, pauseData);

    return { paused: true, checkpoint, pauseData };
  }

  /**
   * Emit `agentfootprint.pause.request` through the dispatcher. Called by
   * `detectPause()`. Subclasses should not emit this directly.
   */
  private emitPauseRequest(checkpoint: FlowchartCheckpoint, pauseData: unknown): void {
    const meta = this.minimalMeta();
    const reasonFromData =
      typeof pauseData === 'object' && pauseData !== null && 'reason' in pauseData
        ? String((pauseData as { reason: unknown }).reason)
        : 'stage requested pause';
    this.dispatcher.dispatch({
      type: 'agentfootprint.pause.request',
      payload: {
        reason: reasonFromData,
        questionPayload:
          typeof pauseData === 'object' && pauseData !== null
            ? (pauseData as Readonly<Record<string, unknown>>)
            : { data: pauseData },
      },
      meta: {
        ...meta,
        runtimeStageId: `${checkpoint.pausedStageId}#paused`,
        subflowPath: checkpoint.subflowPath,
      },
    });
  }

  /**
   * Emit `agentfootprint.pause.resume` through the dispatcher. Called from
   * concrete runners' `resume()` BEFORE invoking `executor.resume()`.
   */
  protected emitPauseResume(checkpoint: FlowchartCheckpoint, input: unknown): void {
    const meta = this.minimalMeta();
    const pausedDurationMs = Date.now() - checkpoint.pausedAt;
    this.dispatcher.dispatch({
      type: 'agentfootprint.pause.resume',
      payload: {
        resumeInput:
          typeof input === 'object' && input !== null
            ? (input as Readonly<Record<string, unknown>>)
            : { input },
        pausedDurationMs,
      },
      meta: {
        ...meta,
        runtimeStageId: `${checkpoint.pausedStageId}#resumed`,
        subflowPath: checkpoint.subflowPath,
      },
    });
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
   */
  attach(recorder: CombinedRecorder): Unsubscribe {
    this.attachedRecorders.push(recorder);
    return () => {
      const idx = this.attachedRecorders.indexOf(recorder);
      if (idx >= 0) this.attachedRecorders.splice(idx, 1);
    };
  }

  // ─── Enable namespace (Tier 3 observability features) ─────────

  readonly enable: EnableNamespace = {
    flowchart: (opts?: FlowchartOptions): FlowchartHandle =>
      // Hand the recorder's attach() AND the dispatcher out as narrow
      // capabilities — no reference to `this`, no coupling to the
      // runner class tree. attachFlowchart wires a TopologyRecorder
      // via the attach path AND subscribes to the event dispatcher
      // for ReAct step transitions (stream.llm_* / stream.tool_*).
      attachFlowchart((r) => this.attach(r), this.dispatcher, opts),
    // v2.8 grouped strategy enablers — see
    // `docs/inspiration/strategy-everywhere.md`.
    observability: (opts) => attachObservabilityStrategy(this.dispatcher, opts),
    cost: (opts) => attachCostStrategy(this.dispatcher, opts),
    liveStatus: (opts) => attachLiveStatusStrategy(this.dispatcher, opts),
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
      runId: 'consumer-scope',
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
