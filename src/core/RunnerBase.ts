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
import { attachLogging, type LoggingOptions } from '../recorders/observability/LoggingRecorder.js';
import {
  attachObservabilityStrategy,
  attachCostStrategy,
  attachLiveStatusStrategy,
} from '../strategies/attach.js';
import {
  attachThinking,
  type ThinkingOptions,
} from '../recorders/observability/ThinkingRecorder.js';
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

  // ─── Subclass hooks ────────────────────────────────────────────

  /**
   * Build the footprintjs FlowChart for this runner. Subclass supplies
   * its specific structure (slot subflows, callLLM stage, routing, etc.).
   */
  abstract toFlowChart(): FlowChart;

  /**
   * Execute the runner. Subclass may override for specialized input
   * mapping, but default invokes toFlowChart() + FlowChartExecutor.
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

  once<K extends AgentfootprintEventType>(type: K, listener: EventListener<K>): Unsubscribe;
  once(type: WildcardSubscription, listener: WildcardListener): Unsubscribe;
  once(type: string, listener: (event: AgentfootprintEvent) => void): Unsubscribe {
    return (
      this.dispatcher.once as unknown as (
        type: string,
        listener: (event: AgentfootprintEvent) => void,
      ) => Unsubscribe
    )(type, listener);
  }

  // ─── Recorder attach ───────────────────────────────────────────

  attach(recorder: CombinedRecorder): Unsubscribe {
    this.attachedRecorders.push(recorder);
    return () => {
      const idx = this.attachedRecorders.indexOf(recorder);
      if (idx >= 0) this.attachedRecorders.splice(idx, 1);
    };
  }

  // ─── Enable namespace (Tier 3 observability features) ─────────

  readonly enable: EnableNamespace = {
    thinking: (opts: ThinkingOptions): Unsubscribe => attachThinking(this.dispatcher, opts),
    logging: (opts?: LoggingOptions): Unsubscribe => attachLogging(this.dispatcher, opts),
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
