/**
 * Strategy interface types for the v2.8 grouped-enabler architecture.
 *
 * Pattern: Strategy + Bridge + Hexagonal port. See the design memo
 *          `docs/inspiration/strategy-everywhere.md`.
 *
 * Four groups, four typed strategy interfaces. Each follows the same
 * shape (one canonical contract, locked at the type level):
 *
 *   1. `name: string`            — registry key for auto-registration
 *   2. `capabilities: {...}`     — what this strategy supports
 *   3. the hot-path method       — sync, side-effect-only. Named per
 *                                  group: `exportEvent` (observability),
 *                                  `recordCost`, `renderStatus`,
 *                                  `renderGraph`. There is no `onEvent`.
 *   4. `flush?(): Promise<void>` — optional batch flushing
 *   5. `stop?(): void`           — optional teardown
 *
 * Design constraints (from the panel review):
 *   - **PASSIVE / non-blocking by construction.** Strategies are
 *     observers — they NEVER block the agent loop. Async work
 *     (HTTP shipment, disk I/O, batching) is the STRATEGY's internal
 *     concern: buffer in `exportEvent` (sync), drain in `flush()`
 *     (async OK). The dispatcher never awaits the hot-path call.
 *   - `exportEvent` MUST be sync `void`. MUST NOT throw. Errors caught +
 *     routed to `_onError` at the dispatch layer; one bad strategy
 *     never breaks the agent loop.
 *   - Idempotent registration — registering the same `name` twice
 *     replaces, doesn't double-fire.
 *   - `stop()` is idempotent — halts everything that strategy enabled,
 *     nothing else, calling twice is a no-op. Since 8.12.0 the framework
 *     also guarantees it is DELIVERED at most once, however many places
 *     share the strategy.
 *   - `flush()` is optional, may be sync OR async — strategies that
 *     don't batch can omit it. Flush is the ONLY async path; the hot
 *     path is always sync.
 *
 * **Who calls `flush()` / `stop()` (8.12.0).** Three doors, and no
 * hidden fourth:
 *
 *   - `const telemetry = agent.enable.observability({...})` returns a
 *     handle. It is still the `Unsubscribe` function it always was —
 *     `telemetry()` detaches, and detaching still never stops your
 *     strategy — and it now also carries `telemetry.flush()` and
 *     `telemetry.stop()`.
 *   - `await agent.shutdown()` drains and releases everything enabled
 *     on that agent, in the one correct order.
 *   - `standingAgent({...})`'s `handle.close()` flushes by default
 *     (`shutdown: 'flush'`), because the last batch reaching the sink
 *     when a server stops is what everyone already assumed happened.
 *
 * `agent.run()` still never flushes: telemetry timing is not the agent
 * loop's business. Opt into a per-run drain with
 * `enable.observability({ flushOn: 'run-end' })`, which fires a flush
 * when a run ends but never gates the run on it.
 */

import type { Unsubscribe } from '../events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../events/registry.js';
import type { StepGraph } from '../recorders/observability/FlowchartRecorder.js';
import type { StatusState } from '../recorders/observability/status/statusTemplates.js';

// ─── What `enable.*` hands back ──────────────────────────────────────

/**
 * What every `enable.*` strategy call returns (8.12.0).
 *
 * **It is still the `Unsubscribe` function.** `telemetry()` detaches the
 * subscription and nothing else, exactly as before — every call site written
 * against the old return type keeps compiling and keeps behaving identically.
 * What is new is that the function also carries two methods, so the object
 * that knows which strategy is attached is the object you can drain:
 *
 * ```ts
 * const telemetry = agent.enable.observability({ strategy: cloudwatch });
 *
 * await telemetry.flush();   // ship what is buffered; keep exporting
 * telemetry();               // detach; strategy keeps running (unchanged law)
 * telemetry.stop();          // release the strategy — timers, clients, buffers
 * ```
 *
 * Or let the scope do it, which cannot be got wrong:
 *
 * ```ts
 * await using telemetry = agent.enable.observability({ strategy: cloudwatch });
 * ```
 *
 * `flush()` enforces the shutdown ORDER internally, which is the part no
 * consumer could do from outside: it drains the detach hop first (events
 * scheduled on a `detach` driver have not reached your strategy yet), then the
 * strategy's own buffer. `stop()` is refcounted — see `BaseStrategy.stop`.
 */
export type StrategyHandle = Unsubscribe &
  AsyncDisposable & {
    /**
     * Ship everything this subscription has produced: first the events still
     * queued on a `detach` driver, then the strategy's own buffer. Safe to
     * call repeatedly and concurrently; never throws at you (a failing
     * exporter reports through its own `_onError`).
     */
    flush(): Promise<void>;
    /**
     * Release this subscription AND, if it was the last one pointing at the
     * strategy, the strategy itself — timers cleared, clients closed. A
     * strategy another runner still shares is left running; stopping is
     * delivered at most once, ever.
     *
     * Does not flush first: call `flush()` before it, or use
     * `agent.shutdown()` / `await using`, which do.
     */
    stop(): void;
  };

/** `StrategyHandle` under the name the observability door returns it. */
export type ObservabilityHandle = StrategyHandle;

// ─── Shared shape every strategy implements ──────────────────────────

/**
 * Common base every strategy carries. Per-group strategies extend this
 * with their own typed hot-path method (`exportEvent`, `recordCost`,
 * `renderStatus`, `renderGraph`) + capability shape.
 */
export interface BaseStrategy {
  /** Registry key. Conventionally lowercase-kebab: `'datadog'`,
   *  `'agentcore'`, `'cloudwatch'`. Used to look up the strategy from
   *  config + de-dupe registrations. */
  readonly name: string;

  /** Optional batch flush — drain whatever the hot path buffered.
   *  Returns `void` for sync sinks (Pino-style) OR `Promise<void>` for
   *  async sinks (Datadog HTTP batch, OTel BatchSpanProcessor).
   *
   *  **Called for you on shutdown (8.12.0), never during a run.** The
   *  handle returned by `enable.observability()` carries `.flush()`,
   *  `await agent.shutdown()` calls it for everything enabled on that
   *  agent, and a `standingAgent` flushes on `close()` by default.
   *  Before 8.12.0 nothing called it, and a batching exporter
   *  (CloudWatch, X-Ray) dropped its final batch whenever the process
   *  exited inside its flush window.
   *
   *  Write it to be safe to call at any time, including twice
   *  concurrently and after your own `stop()` — the shipped AWS
   *  adapters are (a stop cancels the timer and stops accepting; it
   *  does not discard what was already accepted).
   *
   *  ```ts
   *  const telemetry = agent.enable.observability({ strategy });
   *  // …
   *  await telemetry.flush();   // ship what is buffered, keep running
   *  await agent.shutdown();    // drain + release everything enabled
   *  ```
   *
   *  What still does NOT call it: `agent.run()`. Awaiting an exporter
   *  inside a run would make telemetry a run-latency term. Opt into a
   *  per-run drain with `enable.observability({ flushOn: 'run-end' })`
   *  — it fires when a run ends, and does not gate the run. */
  flush?(): void | Promise<void>;

  /** Optional teardown — close clients, clear timers, release handles.
   *  Idempotent: calling twice is a no-op. Strategies that open no
   *  external resources can omit this.
   *
   *  **Terminal**: after it, events are dropped and there is no
   *  restart. So the framework is careful about who may call it:
   *
   *   - The `Unsubscribe` — `telemetry()` — NEVER stops your strategy.
   *     It releases one subscription, exactly as it always did. This is
   *     what lets one strategy instance be enabled, unsubscribed and
   *     enabled again (the audit-export pattern) without losing the
   *     second half of its record.
   *   - `telemetry.stop()` and `agent.shutdown()` DO stop it — but only
   *     once the last subscription pointing at it has been released,
   *     so one runner's shutdown can never blind another runner that
   *     still shares the strategy.
   *   - Delivered AT MOST ONCE per strategy instance, whoever asks.
   *
   *  Flush first, then stop — both doors above already do. */
  stop?(): void;

  /**
   * Optional event-type filter. When set, the dispatcher only forwards
   * events whose `type` is in this set — saves the strategy from
   * filtering itself + reduces hot-path allocations.
   *
   * Per AWS CloudWatch panel review: storage cost scales with size,
   * strategies need to declare what they consume so the framework
   * doesn't force them to inspect everything.
   */
  readonly relevantEventTypes?: readonly AgentfootprintEventType[];

  /**
   * Optional config validator. Called ONCE at registration time —
   * throws if the strategy's options are invalid (wrong API key shape,
   * missing peer dep, unreachable endpoint). Saves customer-support
   * "why is my dashboard empty?" tickets.
   *
   * Per New Relic panel review.
   */
  validate?(): void;

  /**
   * Optional error sink. Called when this strategy itself errors —
   * e.g., HTTP 401 from Datadog, malformed config in pino. Default
   * dispatcher behavior is to swallow + log to console (so one bad
   * exporter doesn't kill the agent loop). Consumers wire this when
   * they want to surface vendor errors in their own tooling.
   *
   * **This is a property you ASSIGN AFTER CONSTRUCTION, not a
   * constructor option**, because it lives on the strategy object
   * rather than in any factory's options:
   *
   * ```ts
   * const strategy = cloudwatchObservability({ logGroupName: '/agent' });
   * strategy._onError = (err, event) => myLogger.warn(err, event?.type);
   * ```
   *
   * Since 8.11.0 the AWS adapters (`cloudwatchObservability`,
   * `agentcoreObservability`, `xrayObservability`, `otelObservability`)
   * also accept an `onError` option in their factory options — that is
   * the preferred door, since it is wired before the first delivery can
   * fail. `_onError` stays for strategies you write yourself and for
   * adapters that take no options.
   *
   * Per New Relic panel review.
   */
  _onError?(error: Error, event?: AgentfootprintEvent): void;
}

// ─── Group 1: Observability ──────────────────────────────────────────

/**
 * Capabilities a strategy declares — matches OTel's 4-signal model
 * (events / logs / traces / metrics). A strategy can opt into any
 * subset. `compose([...])` ORs the children's capabilities.
 *
 *   - `events: true`   → wide structured events (Honeycomb / OTel
 *                        events / Datadog wide events). agentfootprint
 *                        events are this shape natively — most
 *                        strategies should default to `events: true`.
 *   - `logs: true`     → flat log records (pino, console, CloudWatch
 *                        Logs). The strategy reduces a wide event to
 *                        a single log line.
 *   - `traces: true`   → strategy maps events to spans (parent/child
 *                        via `runtimeStageId`).
 *   - `metrics: true`  → strategy aggregates counters / gauges
 *                        (CloudWatch metrics, Mimir, Prometheus).
 */
export interface ObservabilityCapabilities {
  readonly events?: boolean;
  readonly logs?: boolean;
  readonly traces?: boolean;
  readonly metrics?: boolean;
}

/**
 * The single hot-path entry every observability strategy implements.
 * Receives every typed agent event. MUST be sync + side-effect-only +
 * non-throwing.
 *
 * Strategies that batch should buffer in `exportEvent` and drain in
 * `flush()` — which the consumer, not the framework, must call.
 */
export interface ObservabilityStrategy extends BaseStrategy {
  readonly capabilities: ObservabilityCapabilities;
  /**
   * Translate the typed agentfootprint event into the vendor's wire
   * format and ship it to the destination (Datadog API, OTel exporter,
   * pino stream, CloudWatch PutLogEvents, etc.).
   *
   * MUST be sync `void`. Buffer internally; drain in `flush()`.
   */
  exportEvent(event: AgentfootprintEvent): void;
}

// ─── Group 2: Cost ───────────────────────────────────────────────────

/**
 * What a cost strategy receives every time the cost recorder fires.
 * Carries enough info for the strategy to decide whether to ship to
 * billing, log a warning, trigger a circuit breaker, etc.
 */
export interface CostTick {
  readonly cumulativeInputTokens: number;
  readonly cumulativeOutputTokens: number;
  readonly cumulativeCostUsd: number;
  readonly recentInputTokens: number;
  readonly recentOutputTokens: number;
  readonly recentCostUsd: number;
  readonly model: string;
  readonly iteration?: number;
  readonly runtimeStageId?: string;
}

export interface CostCapabilities {
  /** Strategy supports per-tick streaming. `false` for batch-only sinks. */
  readonly streaming?: boolean;
  /** Strategy supports budget enforcement (will throw / break the loop
   *  when budget exceeded). Most strategies are observe-only. */
  readonly enforcement?: boolean;
}

export interface CostStrategy extends BaseStrategy {
  readonly capabilities: CostCapabilities;
  /**
   * Translate the cost tick into the vendor's wire format and ship it
   * (Stripe billing API, accounting webhook, internal metrics sink).
   *
   * MUST be sync `void`. Buffer internally; drain in `flush()`.
   */
  recordCost(tick: CostTick): void;
}

// ─── Group 3: Live status ────────────────────────────────────────────

/**
 * What a status strategy receives every time `selectStatus`
 * returns a new state. The renderer has already resolved templates to
 * a final string; strategies decide where to send it.
 */
export interface StatusUpdate {
  /** Rendered status line (already template-resolved). */
  readonly line: string;
  /** Underlying state for strategies that want to format their own
   *  view (e.g., emit different colors per state in a TUI). */
  readonly state: StatusState;
}

export interface LiveStatusCapabilities {
  /** Strategy supports streaming partial tokens (vs only state
   *  transitions). */
  readonly streaming?: boolean;
}

export interface LiveStatusStrategy extends BaseStrategy {
  readonly capabilities: LiveStatusCapabilities;
  /**
   * Render the rendered status line to the strategy's destination
   * (chat bubble callback, stdout, webhook).
   *
   * MUST be sync `void`.
   */
  renderStatus(update: StatusUpdate): void;
}

// ─── Group 4: Lens ───────────────────────────────────────────────────

/**
 * What a Lens strategy receives — the live StepGraph each time the
 * boundary recorder fires an event that changes the visible structure.
 * Strategies decide how to render: DOM (browser), TUI (CLI), JSON
 * (capture for replay).
 */
export interface LensUpdate {
  readonly graph: StepGraph;
  /** Whether this is the FINAL update (run finished). Strategies that
   *  buffer for animation can flush here. */
  readonly final: boolean;
}

export interface LensCapabilities {
  /** Strategy renders to a UI (browser DOM, TUI). */
  readonly interactive?: boolean;
  /** Strategy serializes for replay / export. */
  readonly serializable?: boolean;
}

export interface LensStrategy extends BaseStrategy {
  readonly capabilities: LensCapabilities;
  /**
   * Render the live StepGraph to the strategy's destination (DOM,
   * TUI, JSON serializer).
   *
   * MUST be sync `void`.
   */
  renderGraph(update: LensUpdate): void;
}

// ─── Union of every strategy shape ───────────────────────────────────

/**
 * Discriminated union for the `compose([...])` combinator and the
 * registry. Lets the registry hold one Map<name, AnyStrategy> while
 * preserving type narrowing per-group via the `kind` discriminator.
 */
export type AnyStrategy =
  | ({ readonly kind: 'observability' } & ObservabilityStrategy)
  | ({ readonly kind: 'cost' } & CostStrategy)
  | ({ readonly kind: 'liveStatus' } & LiveStatusStrategy)
  | ({ readonly kind: 'lens' } & LensStrategy);

export type StrategyKind = AnyStrategy['kind'];

// ─── Tier / sample-rate options every group accepts ──────────────────

/**
 * Cost-of-on knob (per Datadog panel review). Each tier is a soft
 * suggestion — strategies decide what to do per tier (e.g., a
 * `pino` strategy might gzip on `firehose`, an OTel strategy might
 * raise its `BatchSpanProcessor` interval).
 */
export type ObservabilityTier = 'minimal' | 'standard' | 'firehose';

/**
 * Detach mode — controls whether the strategy's hot-path call
 * (e.g. `exportEvent`) runs sync inside the agent loop or is deferred
 * onto a `footprintjs/detach` driver so the loop never blocks.
 *
 * Three semantics:
 *
 *   - `'forget'`  — `detachAndForget`. Discard the handle. Pure
 *                   fire-and-forget telemetry. Errors land on the
 *                   (discarded) handle and go silent unless the
 *                   strategy's own `_onError` surfaces them. Use for
 *                   high-volume exports where dropping a single event
 *                   is acceptable.
 *
 *   - `'join-later'` — `detachAndJoinLater`. The driver returns a
 *                      `DetachHandle`; we deliver it to your
 *                      `onHandle` callback so you can `await` later
 *                      (graceful shutdown, tests, backpressure).
 *
 *   - omitted (default sync) — strategy hot-path runs inline, same as
 *                              every release before v2.8.
 *
 * For graceful shutdown — `await handle.flush()` (or `agent.shutdown()`).
 * Since 8.12.0 that drains the events this subscription scheduled on the
 * driver BEFORE flushing the strategy, which is the order that matters and
 * the one you could not write yourself: a detached event has not reached your
 * strategy's buffer yet, so flushing the strategy alone ships nothing.
 * `flushAllDetached()` (from `'footprintjs/detach'`) remains the
 * process-wide hammer for detached work this library did not schedule.
 */
export interface DetachOptions {
  /** The driver to schedule on. Required — there is no library
   *  default. Pick by environment: `microtaskBatchDriver` (cross-
   *  runtime, default for in-process), `setImmediateDriver` (Node),
   *  `setTimeoutDriver` (cross-runtime, configurable delay),
   *  `sendBeaconDriver` (browser, survives page-unload), etc. */
  readonly driver: import('footprintjs/detach').DetachDriver;

  /** `'forget'` discards the handle (pure telemetry). `'join-later'`
   *  delivers the handle to `onHandle` for later awaiting. Default
   *  `'forget'`. */
  readonly mode?: 'forget' | 'join-later';

  /** Required when `mode === 'join-later'`. Receives every minted
   *  handle. Push to a closure-local array if you want
   *  `Promise.all(handles.map(h => h.wait()))` later, or keep a
   *  rolling window for backpressure. */
  readonly onHandle?: (handle: import('footprintjs/detach').DetachHandle) => void;
}

/**
 * Common options every group accepts. Per-group enablers extend with
 * their own keys (e.g., `templates` for liveStatus, `budget` for cost).
 */
export interface CommonStrategyOptions {
  /**
   * Strategy implementation. Defaults differ per group:
   *   - observability → `console()`
   *   - cost          → `inMemorySink()`
   *   - liveStatus    → consumer-provided callback
   *   - lens          → `browser()` (when in DOM) / `noop()` (else)
   */
  readonly strategy?: BaseStrategy;
  /** 0..1 — fraction of events to forward. 1.0 = all, 0 = none.
   *  Per-Datadog panel review: every observability enabler accepts
   *  this. */
  readonly sampleRate?: number;
  /** Opt-in detach. When set, the strategy's hot-path call (e.g.
   *  `exportEvent`) is scheduled on the given driver instead of
   *  running inline — agent loop never blocks on slow exporters.
   *  See `DetachOptions` for the three semantics. */
  readonly detach?: DetachOptions;
  /**
   * When to flush automatically (8.12.0). Default `'manual'` — the framework
   * flushes on shutdown (`handle.flush()`, `agent.shutdown()`, a
   * `standingAgent` closing) and at no other time.
   *
   * `'run-end'` additionally fires a flush when a run finishes: an Agent's
   * `agent.turn_end`, a composition's `composition.exit`. Use it for scripts
   * and short-lived processes (a Lambda, a cron job) where "the process may
   * vanish right after the answer" is the normal case.
   *
   * **It fires the flush; it does not gate the run.** `run()` resolves when
   * the run is done, exactly as it does today — the drain happens alongside,
   * and a process that exits in the same breath can still outrun it. The
   * honest one-liner for that case is `await handle.flush()` (or
   * `await agent.shutdown()`) after the run; this option shrinks the window,
   * it does not close it. Nothing was made to await inside `run()` because
   * telemetry must never become a term in run latency.
   */
  readonly flushOn?: 'manual' | 'run-end';
}
