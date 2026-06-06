/**
 * Runner — consumer-facing interface for every primitive/composition/pattern.
 *
 * Pattern: Facade (GoF) over the footprintjs FlowChart + EventDispatcher.
 * Role:    The one object consumers hold. Exposes:
 *            - `.run()` (execute)
 *            - `.getSpec()` (the design-time FlowChart blueprint —
 *              same value footprintjs's `addSubFlowChart*` accepts)
 *            - `.on() / .off() / .once()` (listener subscription)
 *            - `.attach()` (attach custom CombinedRecorder)
 *            - `.emit()` (consumer-defined custom events on the same
 *              dispatcher, matches DOM CustomEvent)
 * Emits:   N/A — this file defines the INTERFACE. Concrete runners
 *          (LLMCall, Agent, Sequence, etc.) implement it.
 */

import type { CombinedRecorder, FlowChart, FlowchartCheckpoint, RunOptions } from 'footprintjs';
import type { RunnerPauseOutcome } from './pause.js';
import type {
  EventListener,
  ListenOptions,
  Unsubscribe,
  WildcardListener,
  WildcardSubscription,
} from '../events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../events/registry.js';
import type {
  FlowchartHandle,
  FlowchartOptions,
} from '../recorders/observability/FlowchartRecorder.js';
import type {
  ObservabilityEnableOptions,
  CostEnableOptions,
  LiveStatusEnableOptions,
} from '../strategies/attach.js';

/**
 * High-level feature-enable methods. Each attaches a pre-built observability
 * recorder and returns an Unsubscribe function. Additional methods land in
 * Phase 5 (lens, tracing, cost, guardrails, ...).
 */
export interface EnableNamespace {
  /**
   * Live composition graph — subflow / fork-branch / decision-branch
   * nodes accumulate as execution unfolds. Hook into any graph renderer
   * (React Flow, Cytoscape, D3) without touching footprintjs internals.
   *
   * Returns a handle with `getSnapshot()` so the UI can query the graph
   * at any time (not just via onUpdate).
   */
  flowchart(opts?: FlowchartOptions): FlowchartHandle;
  /**
   * v2.8+ — grouped strategy enabler for observability. Pipes every
   * typed event into a vendor strategy (Datadog, OTel, AgentCore,
   * CloudWatch, …) or the default `consoleObservability()`. See
   * `agentfootprint/strategies` + `docs/inspiration/strategy-everywhere.md`.
   */
  observability(opts?: ObservabilityEnableOptions): Unsubscribe;
  /**
   * v2.8+ — grouped strategy enabler for cost. Subscribes the strategy
   * to `cost.tick` events; defaults to `inMemorySinkCost()` for
   * read-back / test inspection.
   */
  cost(opts?: CostEnableOptions): Unsubscribe;
  /**
   * v2.8+ — grouped strategy enabler for chat-bubble live status.
   * Maintains the thinking-state machine; calls strategy.renderStatus
   * each time the rendered line changes (deduped — not on every token).
   * Strategy is required (consumer must wire UI).
   */
  liveStatus(opts: LiveStatusEnableOptions): Unsubscribe;
}

/**
 * Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
 * Conditional, Loop), and every pattern factory result implements Runner.
 * That makes them freely nestable: any runner can be a child of any
 * composition.
 */
export interface Runner<TIn = unknown, TOut = unknown> {
  /**
   * Return the footprintjs FlowChart for this runner — the canonical
   * design-time blueprint. Stable across calls. Pairs with the run-time
   * accessors (`getLastSnapshot`, `getCommitCount`) and matches
   * `ExplainableShell.spec` + `specToReactFlow(spec, ...)` consumer
   * conventions.
   *
   * Subflow mounting (footprintjs `addSubFlowChart*`) accepts the
   * `FlowChart` value directly:
   *
   *   parent.addSubFlowChartNext('sf-agent', child.getSpec(), 'Agent')
   */
  getSpec(): FlowChart;

  /**
   * Return the consumer-shaped UI group for this runner — produced by
   * invoking the `groupTranslator` (if one was attached at constructor
   * time) with this composition's metadata. Returns `undefined` when no
   * translator was attached.
   *
   * Companion of `getSpec()`: `getSpec()` is the canonical (UI-
   * agnostic) blueprint; `getUIGroup()` is the consumer-shaped view.
   * Both are stable post-construction.
   *
   * See `core/translator.ts` for the `GroupTranslator` /
   * `GroupMetadata` types.
   */
  getUIGroup<T = unknown>(): T | undefined;

  /**
   * Translate this runner's group metadata with a CALLER-SUPPLIED
   * translator that OVERRIDES whatever translator (if any) the runner
   * was constructed with. Used by parent compositions to apply
   * per-method translator overrides (e.g.,
   * `Parallel.create(...).branch('special', runner, { groupTranslator: ... })`
   * — for the `'special'` branch only, this `override` runs against
   * `runner`'s own `GroupMetadata` instead of the runner's default
   * translator).
   *
   * NOT cached at the runner level. The caller invokes this exactly
   * once per build (parent's `buildUIGroupMetadata`) and caches the
   * resulting `uiGroup` via the parent's `RunnerBase.uiGroupCache`.
   *
   * Returns `undefined` when this runner has no group metadata to
   * translate (i.e., `buildUIGroupMetadata()` returned `undefined`).
   */
  getUIGroupWith<T = unknown>(override: import('./translator.js').GroupTranslator): T | undefined;

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
