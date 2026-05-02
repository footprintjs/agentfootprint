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
 *   3. `onEvent(...)`            — hot path; sync, side-effect-only
 *   4. `flush?(): Promise<void>` — optional batch flushing
 *   5. `stop?(): void`           — optional teardown
 *
 * Design constraints (from the panel review):
 *   - **PASSIVE / non-blocking by construction.** Strategies are
 *     observers — they NEVER block the agent loop. Async work
 *     (HTTP shipment, disk I/O, batching) is the STRATEGY's internal
 *     concern: buffer in `onEvent` (sync), drain in `flush()` (async
 *     OK). The dispatcher never awaits a strategy's `onEvent`.
 *   - `onEvent` MUST be sync `void`. MUST NOT throw. Errors caught +
 *     routed to `_onError` at the dispatch layer; one bad strategy
 *     never breaks the agent loop.
 *   - Idempotent registration — registering the same `name` twice
 *     replaces, doesn't double-fire.
 *   - `stop()` is idempotent — halts everything that strategy enabled,
 *     nothing else, calling twice is a no-op.
 *   - `flush()` is optional, may be sync OR async — strategies that
 *     don't batch can omit it. Consumer's `agent.run()` lifecycle
 *     calls flush at boundary points (turn end, run end) so batched
 *     strategies don't lose tail events. Flush is the ONLY async
 *     path; the hot path is always sync.
 */

import type { AgentfootprintEvent, AgentfootprintEventType } from '../events/registry.js';
import type { StepGraph } from '../recorders/observability/FlowchartRecorder.js';
import type { ThinkingState } from '../recorders/observability/thinking/thinkingTemplates.js';

// ─── Shared shape every strategy implements ──────────────────────────

/**
 * Common base every strategy carries. Per-group strategies extend this
 * with their typed `onEvent` signature + capability shape.
 */
export interface BaseStrategy {
  /** Registry key. Conventionally lowercase-kebab: `'datadog'`,
   *  `'agentcore'`, `'cloudwatch'`. Used to look up the strategy from
   *  config + de-dupe registrations. */
  readonly name: string;

  /** Optional batch flush. Returns `void` for sync sinks (Pino-style)
   *  OR `Promise<void>` for async sinks (Datadog HTTP batch, OTel
   *  BatchSpanProcessor). Called before `agent.run()` resolves so
   *  batched exporters don't lose tail events. */
  flush?(): void | Promise<void>;

  /** Optional teardown. Called on `stop()` returned by `enable.X`.
   *  Idempotent — calling twice is a no-op. Strategies that open no
   *  external resources can omit this. */
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
 * Strategies that batch should buffer in `onEvent` and drain in
 * `flush()`.
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
 * What a status strategy receives every time `selectThinkingState`
 * returns a new state. The renderer has already resolved templates to
 * a final string; strategies decide where to send it.
 */
export interface StatusUpdate {
  /** Rendered status line (already template-resolved). */
  readonly line: string;
  /** Underlying state for strategies that want to format their own
   *  view (e.g., emit different colors per state in a TUI). */
  readonly state: ThinkingState;
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
 * For graceful shutdown — call `flushAllDetached()` (from
 * `'footprintjs/detach'`) in your SIGTERM handler. Drains every
 * in-flight detached handle process-wide.
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
}
