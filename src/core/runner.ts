/**
 * Runner — consumer-facing interface for every primitive/composition/pattern.
 *
 * Pattern: Facade (GoF) over ComposableRunner + EventDispatcher.
 * Role:    The one object consumers hold. Exposes:
 *            - `.run()` / `.toFlowChart()` (inherited from footprintjs
 *              ComposableRunner — composition + execution)
 *            - `.on() / .off() / .once()` (listener subscription)
 *            - `.attach()` (attach custom CombinedRecorder)
 *            - `.emit()` (consumer-defined custom events on the same
 *              dispatcher, matches DOM CustomEvent)
 * Emits:   N/A — this file defines the INTERFACE. Concrete runners
 *          (LLMCall, Agent, Sequence, etc.) implement it.
 */

import type {
  CombinedRecorder,
  ComposableRunner,
  FlowchartCheckpoint,
  RunOptions,
} from 'footprintjs';
import type { RunnerPauseOutcome } from './pause.js';
import type {
  EventListener,
  ListenOptions,
  Unsubscribe,
  WildcardListener,
  WildcardSubscription,
} from '../events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../events/registry.js';
import type { LoggingOptions } from '../recorders/observability/LoggingRecorder.js';
import type { ThinkingOptions } from '../recorders/observability/ThinkingRecorder.js';
import type {
  FlowchartHandle,
  FlowchartOptions,
} from '../recorders/observability/FlowchartRecorder.js';

/**
 * High-level feature-enable methods. Each attaches a pre-built observability
 * recorder and returns an Unsubscribe function. Additional methods land in
 * Phase 5 (lens, tracing, cost, guardrails, ...).
 */
export interface EnableNamespace {
  /** Claude-Code-style live status line. */
  thinking(opts: ThinkingOptions): Unsubscribe;
  /** Firehose-style structured logging of every event. */
  logging(opts?: LoggingOptions): Unsubscribe;
  /**
   * Live composition graph — subflow / fork-branch / decision-branch
   * nodes accumulate as execution unfolds. Hook into any graph renderer
   * (React Flow, Cytoscape, D3) without touching footprintjs internals.
   *
   * Unlike thinking/logging which return a plain Unsubscribe, this
   * returns a handle with `getSnapshot()` so the UI can query the graph
   * at any time (not just via onUpdate).
   */
  flowchart(opts?: FlowchartOptions): FlowchartHandle;
}

/**
 * Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
 * Conditional, Loop), and every pattern factory result implements Runner.
 * That makes them freely nestable: any runner can be a child of any
 * composition.
 */
export interface Runner<TIn = unknown, TOut = unknown>
  extends Omit<ComposableRunner<TIn, TOut>, 'run'> {
  /**
   * Execute the runner. On happy-path completion, resolves with `TOut`.
   * If any stage (Agent tool via `pauseHere`, nested runner, or consumer
   * scope code) called `scope.$pause()`, resolves with a `RunnerPauseOutcome`
   * carrying the serializable checkpoint. Discriminate with `isPaused()`.
   */
  run(input: TIn, options?: RunOptions): Promise<TOut | RunnerPauseOutcome>;

  /**
   * Resume a previously-paused execution from its checkpoint. `input` is
   * delivered to the paused stage's resume handler. The same return shape
   * as `run()`: `TOut` on completion, `RunnerPauseOutcome` if execution
   * pauses again (e.g., a multi-step approval flow).
   */
  resume(
    checkpoint: FlowchartCheckpoint,
    input?: unknown,
    options?: RunOptions,
  ): Promise<TOut | RunnerPauseOutcome>;

  /** Subscribe a typed listener. Returns unsubscribe. */
  on<K extends AgentfootprintEventType>(
    type: K,
    listener: EventListener<K>,
    options?: ListenOptions,
  ): Unsubscribe;
  /** Subscribe to a domain wildcard (e.g. 'agentfootprint.context.*') or '*'. */
  on(type: WildcardSubscription, listener: WildcardListener, options?: ListenOptions): Unsubscribe;

  /** Unsubscribe a previously-registered listener. */
  off<K extends AgentfootprintEventType>(type: K, listener: EventListener<K>): void;
  off(type: WildcardSubscription, listener: WildcardListener): void;

  /** Subscribe a one-shot listener (fires once then auto-removes). */
  once<K extends AgentfootprintEventType>(type: K, listener: EventListener<K>): Unsubscribe;
  once(type: WildcardSubscription, listener: WildcardListener): Unsubscribe;

  /**
   * Attach a footprintjs CombinedRecorder to observe the execution.
   * Returns an unsubscribe function — call it to detach the recorder
   * from future runs. (Already-running executions continue using it.)
   */
  attach(recorder: CombinedRecorder): Unsubscribe;

  /**
   * Enable-namespace for high-level observability features. Each method
   * attaches a pre-built CombinedRecorder and returns an unsubscribe
   * function. Consumers write ONE line to enable rich observability,
   * instead of N `.on()` subscriptions.
   */
  readonly enable: EnableNamespace;

  /**
   * Emit a consumer-defined custom event through the same dispatcher.
   *
   * Matches DOM CustomEvent. Useful for domain-specific events outside
   * the 47-event registry (e.g. `myapp.billing.checkpoint`). Library
   * events are reserved under the `agentfootprint.*` namespace.
   */
  emit(name: string, payload: Record<string, unknown>): void;
}

/** Kept for convenience — mirrors the RunOptions export from footprintjs. */
export type { RunOptions };

/**
 * Union used in emit() for the `AgentfootprintEvent` type constraint. A
 * consumer emitting a custom event passes a plain object payload; the
 * dispatcher wraps it as AgentfootprintEvent only when the name is a
 * registered type. Otherwise it flows through as an opaque custom event.
 */
export type EmittedEvent = AgentfootprintEvent;
