/**
 * Wire each grouped strategy to its data source on the dispatcher /
 * recorder substrate. These are the 4 `enable.*` facades' actual
 * implementations; `RunnerBase.enable` calls them with the right
 * dispatcher / attach handle.
 *
 * Pattern: every facade follows the same shape:
 *
 *   1. Resolve strategy (consumer-supplied OR default)
 *   2. Run `strategy.validate?()` — early-fail on misconfig (New Relic
 *      panel review)
 *   3. Set up subscription / projection
 *   4. Apply per-strategy event-type filter (`relevantEventTypes`)
 *   5. Apply per-call sample rate
 *   6. Wrap calls in try/catch — route errors to `_onError` (passive
 *      recorder rule: never throw to caller)
 *   7. Return Unsubscribe (or handle for lens)
 */

import { FlowChartExecutor, flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';

import type { EventDispatcher, Unsubscribe } from '../events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../events/registry.js';
import type {
  BaseStrategy,
  ObservabilityStrategy,
  CostStrategy,
  CostTick,
  LiveStatusStrategy,
  StatusUpdate,
  CommonStrategyOptions,
  ObservabilityHandle,
  ObservabilityTier,
  StrategyHandle,
  DetachOptions,
} from './types.js';
import {
  ASYNC_DISPOSE,
  releaseStrategy,
  retainStrategy,
  stopStrategyIfUnused,
} from './lifecycle.js';
import {
  selectStatus,
  renderStatusLine,
  defaultStatusTemplates,
  type StatusTemplates,
} from '../recorders/observability/status/statusTemplates.js';

/**
 * Build the handle `enable.*` returns: the `Unsubscribe` it always was, plus
 * `flush()` / `stop()` / `await using` support.
 *
 * THE ORDER LAW lives here, in the one object that knows both halves of what
 * this subscription owns:
 *
 *   1. drain the detach hop — events scheduled on a `detach` driver have not
 *      reached the strategy yet, so flushing the strategy first ships nothing
 *   2. flush the strategy's own buffer
 *   3. only then may `stop()` cancel timers and release clients
 *
 * The reverse order is not a style preference: until 8.11.1 a `stop()` before
 * a `flush()` spun the event loop of the process trying to shut down. Putting
 * the order inside the handle is what makes it impossible to get wrong from
 * outside.
 */
function makeStrategyHandle(args: {
  readonly strategy: BaseStrategy;
  readonly unsubscribe: Unsubscribe;
  readonly drainDetached: () => Promise<void>;
}): StrategyHandle {
  let released = false;
  const flush = async (): Promise<void> => {
    await args.drainDetached();
    try {
      await args.strategy.flush?.();
    } catch {
      // Passive-recorder rule: a failing exporter reports through its own
      // `_onError`; a shutdown must not inherit its exception.
    }
  };
  const handle = Object.assign(
    (): void => {
      // Detach only. Releasing a subscription NEVER stops a strategy — see
      // strategies/lifecycle.ts, law 1.
      if (released) return;
      released = true;
      args.unsubscribe();
      releaseStrategy(args.strategy);
    },
    {
      flush,
      stop: (): void => {
        // Releasing THIS subscription is part of stopping: "I am done with
        // it". Whether the STRATEGY stops then depends on whether anyone
        // else still holds it.
        handle();
        stopStrategyIfUnused(args.strategy);
      },
      [ASYNC_DISPOSE]: async (): Promise<void> => {
        await flush();
        handle();
        stopStrategyIfUnused(args.strategy);
      },
    },
  );
  // The computed `ASYNC_DISPOSE` key gives TypeScript a symbol INDEX
  // signature rather than the one well-known member `AsyncDisposable` names,
  // so the cast goes through `unknown`. At runtime the key IS
  // `Symbol.asyncDispose` on every engine this package supports.
  return handle as unknown as StrategyHandle;
}

/**
 * Sentinel returned when consumer calls `enable.X()` without supplying
 * a strategy or vendor. We DON'T auto-default — that would be an
 * unwelcome opinion. Consumer chose to call `enable.X` but didn't hand
 * us anywhere to ship; just no-op silently and return a handle so the
 * call site stays composable and `handle.flush()` is never the one path
 * that throws.
 */
const NOOP_HANDLE: StrategyHandle = Object.assign((): void => undefined, {
  flush: (): Promise<void> => Promise.resolve(),
  stop: (): void => undefined,
  [ASYNC_DISPOSE]: (): Promise<void> => Promise.resolve(),
}) as unknown as StrategyHandle;

// ─── Detach plumbing ─────────────────────────────────────────────────
//
// When a strategy enables `detach: { driver, mode? }`, we wrap the
// hot-path call (e.g. `strategy.exportEvent(event)`) in a tiny
// flowchart and hand it to the driver. The driver schedules it
// (microtask / setImmediate / sendBeacon / worker / etc.) and the
// agent loop returns immediately.
//
// We build the wrapper chart ONCE per attach (closure-captures the
// strategy's hot-path function + its `_onError` hook), then reuse it
// for every event. Per-event allocation stays at handle + work-item
// (the floor for detached scheduling).

interface DetachRouterArgs {
  /** The work to perform. Passed `event` as `scope.$getArgs()`. */
  readonly work: (input: unknown) => void;
  /** Strategy's error hook, called when work throws. */
  readonly onError?: (err: Error, event: unknown) => void;
}

/** Build a one-stage flowchart that performs `args.work(event)` and
 *  routes any thrown error to `args.onError`. The driver schedules
 *  this chart per event. */
function buildDetachWrapperChart(args: DetachRouterArgs): FlowChart {
  return flowChart(
    'agentfootprint:detach:wrapper',
    async (scope) => {
      const event = scope.$getArgs();
      try {
        args.work(event);
      } catch (err) {
        args.onError?.(err instanceof Error ? err : new Error(String(err)), event);
      }
    },
    'wrap',
  ).build();
}

let detachExecutorSingleton: FlowChartExecutor | undefined;

/**
 * A shared `FlowChartExecutor` used purely as the bare-executor entry point
 * for `detachAndForget` / `detachAndJoinLater`. No chart actually runs through
 * it — we just need its detach methods. Built on first detached event; a
 * consumer who never enables `detach` never constructs one.
 *
 * SYNCHRONOUS since 8.11.1, and that is the whole fix. This used to `await
 * import('footprintjs')`, so scheduling happened in a promise continuation:
 * the detach handle was registered a microtask AFTER the event was dispatched.
 * `flushAllDetached()` drains "until the registry is empty" and the registry
 * was still empty when it looked, so the documented shutdown recipe returned
 * `{ done: 0, failed: 0, pending: 0 }` — a clean bill of health — while events
 * were still in flight, and no consumer could wait for them because the
 * pending work lived in a `.then()` chain this module never handed out. The
 * dynamic import also bought nothing: this module already imports
 * `footprintjs` statically for `flowChart`, so the package was loaded either
 * way.
 */
function getDetachExecutor(): FlowChartExecutor {
  if (detachExecutorSingleton) return detachExecutorSingleton;
  // Trivial host chart — never run, just satisfies the constructor.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noopHostStage = async (): Promise<void> => {};
  const noopChart = flowChart('agentfootprint:detach:host', noopHostStage, 'host').build();
  detachExecutorSingleton = new FlowChartExecutor(noopChart);
  return detachExecutorSingleton;
}

/**
 * Build an event-handling function that respects `opts.detach`.
 *
 *   - `opts.detach` undefined → returns a sync handler that runs
 *     `work(event)` inline and routes errors to `onError`. Same as
 *     pre-v2.8 behavior.
 *
 *   - `opts.detach` set → returns a handler that schedules a wrapper
 *     chart on the driver. `mode === 'forget'` discards the handle;
 *     `mode === 'join-later'` delivers it to `opts.detach.onHandle`.
 *
 * The executor singleton is built on first detached event, so consumers who
 * don't enable detach pay zero cost. Scheduling itself is SYNCHRONOUS: the
 * detach handle is registered in the same tick as the event, which is what
 * makes `flushAllDetached()` able to see it (see `getDetachExecutor`).
 */
interface EventHandler {
  /** Deliver one event — inline, or scheduled on the detach driver. */
  readonly deliver: (event: unknown) => void;
  /** Wait for every event this handler scheduled to reach the strategy.
   *  Resolves immediately when `detach` is not in use. */
  readonly drainDetached: () => Promise<void>;
}

/** Max passes `drainDetached` will make. Bounded by construction: work
 *  scheduled BY the drained work is picked up by the next pass, and a drain
 *  that will not settle must end rather than retry forever. */
const DETACH_DRAIN_PASSES = 8;

function buildEventHandler(
  detach: DetachOptions | undefined,
  args: DetachRouterArgs,
): EventHandler {
  if (!detach) {
    // Sync path — current behavior.
    return {
      deliver: (event) => {
        try {
          args.work(event);
        } catch (err) {
          args.onError?.(err instanceof Error ? err : new Error(String(err)), event);
        }
      },
      drainDetached: () => Promise.resolve(),
    };
  }

  // Detached path — schedule via the driver. We need the wrapper chart
  // (for the runChild side) and the executor (for the bare-executor
  // entry point that returns / discards the handle).
  const wrapperChart = buildDetachWrapperChart(args);
  const mode = detach.mode ?? 'forget';
  const onHandle = detach.onHandle;
  if (mode === 'join-later' && !onHandle) {
    throw new TypeError(
      `[enable.*] detach.mode === 'join-later' requires \`onHandle\`. ` +
        `Without it, the returned DetachHandle would be unreachable. ` +
        `Pass \`onHandle: (h) => myHandles.push(h)\` (and await later via ` +
        `Promise.all(myHandles.map(h => h.wait()))).`,
    );
  }

  // Every event scheduled but not yet delivered to the strategy. This is the
  // queue `handle.flush()` drains first, and it is the reason a detached
  // export can be drained AT ALL: the events are here, not in the strategy's
  // buffer, so flushing the strategy alone would ship nothing.
  //
  // `mode: 'forget'` keeps its meaning — the consumer never sees these
  // handles. We hold them ourselves, and drop each one the moment it settles,
  // so the set is bounded by what is genuinely in flight. (`detachAndForget`
  // in footprintjs IS `detachAndJoinLater` with the handle discarded, so this
  // is the same scheduling path, not a second one.)
  const inFlight = new Set<import('footprintjs/detach').DetachHandle>();
  const track = (handle: import('footprintjs/detach').DetachHandle): void => {
    inFlight.add(handle);
    const forget = (): void => {
      inFlight.delete(handle);
    };
    void handle.wait().then(forget, forget);
  };

  return {
    deliver: (event) => {
      // Schedules in THIS tick and returns immediately — the driver owns when
      // the work runs, we only hand it over. Handing over synchronously is what
      // puts the handle in the detach registry before the caller's next line,
      // so a shutdown that calls `flushAllDetached()` actually drains this
      // event instead of finding an empty registry (8.11.1).
      try {
        const handle = getDetachExecutor().detachAndJoinLater(detach.driver, wrapperChart, event);
        track(handle);
        // Caller validates onHandle is set when mode !== 'forget' (see
        // mode-discrimination above; the mode='joinLater' branch requires it).
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (mode !== 'forget') onHandle!(handle);
      } catch (err) {
        args.onError?.(err instanceof Error ? err : new Error(String(err)), event);
      }
    },
    drainDetached: async (): Promise<void> => {
      for (let pass = 0; pass < DETACH_DRAIN_PASSES && inFlight.size > 0; pass++) {
        await Promise.allSettled([...inFlight].map((handle) => handle.wait()));
        // Let the `forget` continuations above run, so `inFlight.size` tells
        // the truth before the next pass reads it.
        await Promise.resolve();
      }
    },
  };
}

/**
 * The events that mean "a run just ended", for `flushOn: 'run-end'`.
 *
 * Named explicitly rather than pattern-matched, because a flush is a network
 * round trip and guessing which events are terminal would fire it in the
 * middle of runs. An Agent ends a turn; a composition (Sequence, Parallel,
 * Conditional, Loop) exits. A runner that emits neither simply never
 * auto-flushes — `flushOn` promises nothing it cannot see.
 */
const RUN_END_EVENTS = [
  'agentfootprint.agent.turn_end',
  'agentfootprint.composition.exit',
] as unknown as readonly AgentfootprintEventType[];

/**
 * Wire `flushOn: 'run-end'`. Returns the subscriptions to release when the
 * handle is unsubscribed (empty for the default `'manual'`).
 *
 * The flush is FIRED, never awaited: `run()` resolves when the run is done,
 * and nothing here may add exporter latency to it. Failures are already
 * swallowed inside `handle.flush()` and reported through the strategy's own
 * `_onError`.
 */
function subscribeRunEndFlush(
  dispatcher: EventDispatcher,
  flushOn: 'manual' | 'run-end' | undefined,
  handle: StrategyHandle,
): Unsubscribe[] {
  if (flushOn !== 'run-end') return [];
  return RUN_END_EVENTS.map((type) =>
    dispatcher.on(type, () => {
      void handle.flush();
    }),
  );
}

// There is ONE way to wire a strategy: pass the instance —
// `enable.observability({ strategy })`. A by-name `{ vendor, config }`
// registry was declared alongside it for years and never wired to
// anything; it was removed in 9.x rather than finished, because two
// doors onto one job is the thing that makes a library hard to learn,
// and the instance door is the one that composes (a consumer's own
// sink needs no name). The cache family keeps its registry for the
// opposite reason: there a vendor strategy must attach itself from a
// side-effect import, so the NAME is the only handle the consumer has.

// ─── Observability ───────────────────────────────────────────────────

export interface ObservabilityEnableOptions extends CommonStrategyOptions {
  /** Cost-of-on knob: how many events reach the sink. `'minimal'` -> agent
   *  lifecycle + errors. `'standard'` -> everything except per-token streams.
   *  `'firehose'` -> every event. Default `'standard'`.
   *
   *  **This is not a privacy control.** No tier redacts anything, and a lower
   *  tier is not a safer one: `'minimal'` still ships `agent.turn_start`
   *  (`userPrompt`), `agent.turn_end` (`finalContent`) and `agent.iteration_end`
   *  (the full conversation `history[]`), so it delivers fewer events but a
   *  higher share of content-bearing ones. `'standard'` adds raw tool arguments
   *  and results (`stream.tool_start` / `tool_end`), retrieved text
   *  (`context.injected.rawContent`) and raw reasoning
   *  (`stream.thinking_delta`).
   *
   *  If prompts or documents must not leave the process, choose a strategy that
   *  bounds payloads — `auditExport()` bounds by default, `otelObservability()`
   *  omits `userPrompt` — or bound them yourself in your own `exportEvent`.
   *  `redactContent` does NOT apply here: it operates on the offline
   *  `serializeTrace` / `localObservability` channel, not on this one. */
  readonly tier?: ObservabilityTier;
  readonly strategy?: ObservabilityStrategy;
}

const TIER_FILTER: Record<ObservabilityTier, (type: string) => boolean> = {
  minimal: (t) => t.startsWith('agentfootprint.error.') || t.startsWith('agentfootprint.agent.'),
  standard: (t) => !t.startsWith('agentfootprint.stream.token'),
  firehose: () => true,
};

export function attachObservabilityStrategy(
  dispatcher: EventDispatcher,
  opts: ObservabilityEnableOptions = {},
): ObservabilityHandle {
  const strategy = opts.strategy;
  // Consumer chose to call enable.observability() but didn't supply
  // a strategy. Don't auto-default — that imposes an opinion. Just
  // no-op so the call site stays composable.
  if (!strategy) return NOOP_HANDLE;
  strategy.validate?.();
  const tierFilter = TIER_FILTER[opts.tier ?? 'standard'];
  const sampleRate = opts.sampleRate ?? 1;
  const relevant = strategy.relevantEventTypes
    ? new Set<AgentfootprintEventType>(strategy.relevantEventTypes)
    : null;

  // Build the event handler ONCE per attach call. Sync if no
  // `opts.detach`; otherwise schedules on the driver so the agent
  // loop never blocks on slow exporters.
  const events = buildEventHandler(opts.detach, {
    work: (event) => strategy.exportEvent(event as AgentfootprintEvent),
    onError: (err, event) => strategy._onError?.(err, event as AgentfootprintEvent),
  });

  retainStrategy(strategy);
  const subscriptions: Unsubscribe[] = [];
  const handle = makeStrategyHandle({
    strategy,
    unsubscribe: () => {
      for (const off of subscriptions) off();
    },
    drainDetached: events.drainDetached,
  });
  subscriptions.push(
    dispatcher.on('*', (event: AgentfootprintEvent) => {
      if (!tierFilter(event.type)) return;
      if (relevant && !relevant.has(event.type)) return;
      if (sampleRate < 1 && Math.random() > sampleRate) return;
      events.deliver(event);
    }),
    ...subscribeRunEndFlush(dispatcher, opts.flushOn, handle),
  );
  return handle;
}

// ─── Cost ────────────────────────────────────────────────────────────

export interface CostEnableOptions extends CommonStrategyOptions {
  readonly strategy?: CostStrategy;
}

/**
 * Subscribe to `agentfootprint.cost.tick` events, project payload into
 * the canonical `CostTick` shape, hand to strategy.
 *
 * **The projection reads `CostTickPayload`, which is not spelled like
 * `CostTick`.** It never was: the wire payload `emitCostTick` produces carries
 * `tokensInput` / `tokensOutput` / `estimatedUsd` for the call just billed and
 * a nested `cumulative` for the run so far, while the strategy-facing
 * {@link CostTick} says `recent*` / `cumulative*`. This projection used to read
 * the strategy names off the payload, so every field resolved to `?? 0` and
 * every attached cost strategy — billing sinks, budget breakers, dashboards —
 * was handed a tick of zeros. A tick of zeros is worse than no tick: it looks
 * like a run that cost nothing.
 *
 * The `?? p.recent*` / `?? p.cumulative*` fallbacks below are NOT that bug left
 * in place. They cover an event hand-constructed from the public `CostTick`
 * shape rather than emitted by the library — the same allowance the X-Ray and
 * OTel exporters already make for this one event type (`xray.ts`, `otel.ts`),
 * and the real shape is what wins when both are present.
 */
export function attachCostStrategy(
  dispatcher: EventDispatcher,
  opts: CostEnableOptions = {},
): StrategyHandle {
  const strategy = opts.strategy;
  if (!strategy) return NOOP_HANDLE;
  strategy.validate?.();

  // Cost strategy detach mirrors observability — sync by default,
  // schedules on the driver when `opts.detach` is set. Useful when
  // `recordCost` does heavy work (per-tick DB write, vendor budget
  // API, etc.).
  const events = buildEventHandler(opts.detach, {
    work: (tickInput) => strategy.recordCost(tickInput as CostTick),
    onError: (err, tickInput) =>
      strategy._onError?.(err, tickInput as unknown as AgentfootprintEvent),
  });

  retainStrategy(strategy);
  const subscriptions: Unsubscribe[] = [];
  const handle = makeStrategyHandle({
    strategy,
    unsubscribe: () => {
      for (const off of subscriptions) off();
    },
    drainDetached: events.drainDetached,
  });
  subscriptions.push(
    dispatcher.on(
      'agentfootprint.cost.tick' as AgentfootprintEventType,
      (event: AgentfootprintEvent) => {
        const p = event.payload as unknown as Record<string, unknown>;
        const cum = (p.cumulative ?? {}) as Record<string, unknown>;
        // `iteration` and `runtimeStageId` ride the ENVELOPE, not the payload —
        // the dispatcher stamps them on every event, so a strategy that wants to
        // attribute spend to a loop turn has to be handed them from there.
        // `meta` is optional here only because an event can be dispatched by hand.
        const meta = event.meta as AgentfootprintEvent['meta'] | undefined;
        const tick: CostTick = {
          cumulativeInputTokens: Number(cum.tokensInput ?? p.cumulativeInputTokens ?? 0),
          cumulativeOutputTokens: Number(cum.tokensOutput ?? p.cumulativeOutputTokens ?? 0),
          cumulativeCostUsd: Number(cum.estimatedUsd ?? p.cumulativeCostUsd ?? 0),
          recentInputTokens: Number(p.tokensInput ?? p.recentInputTokens ?? 0),
          recentOutputTokens: Number(p.tokensOutput ?? p.recentOutputTokens ?? 0),
          recentCostUsd: Number(p.estimatedUsd ?? p.recentCostUsd ?? 0),
          model: String(p.model ?? 'unknown'),
          // Optional on the payload for one honest reason (see `CostTickPayload`):
          // a window strategy's summarizer spend may not name its provider. Absent
          // stays absent rather than becoming 'unknown', which would be a claim.
          ...(typeof p.provider === 'string' ? { provider: p.provider } : {}),
          ...(typeof meta?.iterIndex === 'number'
            ? { iteration: meta.iterIndex }
            : typeof p.iteration === 'number'
            ? { iteration: p.iteration }
            : {}),
          ...(typeof meta?.runtimeStageId === 'string'
            ? { runtimeStageId: meta.runtimeStageId }
            : typeof p.runtimeStageId === 'string'
            ? { runtimeStageId: p.runtimeStageId }
            : {}),
        };
        events.deliver(tick);
      },
    ),
    ...subscribeRunEndFlush(dispatcher, opts.flushOn, handle),
  );
  return handle;
}

// ─── Live status ─────────────────────────────────────────────────────

export interface LiveStatusEnableOptions extends CommonStrategyOptions {
  readonly strategy: LiveStatusStrategy; // required — consumer must wire UI
  /** Override the bundled English thinking templates with locale /
   *  per-tool / per-skill overrides. Same shape as
   *  `agent.thinkingTemplates(...)`. */
  readonly templates?: StatusTemplates;
  /** App name woven into `{{appName}}` template var. */
  readonly appName?: string;
}

/**
 * Subscribe to '*', maintain a rolling event log, project current
 * thinking state on each event, render via templates, hand to strategy.
 *
 * Lower bound on emissions: dedupes — only fires `renderStatus` when
 * the rendered line CHANGES (avoids floods on every token).
 */
/** Sliding-window cap for `attachLiveStatusStrategy`'s internal event
 *  log. Long-lived agent servers would otherwise leak memory through
 *  unbounded growth (per OTel SIG panel review). The cap is high
 *  enough that `selectStatus` always sees the relevant recent
 *  history. */
const LIVE_STATUS_LOG_CAP = 1000;

export function attachLiveStatusStrategy(
  dispatcher: EventDispatcher,
  opts: LiveStatusEnableOptions,
): StrategyHandle {
  opts.strategy.validate?.();
  const templates = { ...defaultStatusTemplates, ...(opts.templates ?? {}) };
  const ctx = { appName: opts.appName ?? 'Agent' };
  const eventLog: AgentfootprintEvent[] = [];
  let lastLine: string | null = null;

  retainStrategy(opts.strategy);
  const subscriptions: Unsubscribe[] = [];
  const handle = makeStrategyHandle({
    strategy: opts.strategy,
    unsubscribe: () => {
      for (const off of subscriptions) off();
    },
    // Live status renders inline (a UI callback); there is no detach hop.
    drainDetached: () => Promise.resolve(),
  });
  subscriptions.push(
    dispatcher.on('*', (event: AgentfootprintEvent) => {
      eventLog.push(event);
      // Sliding-window — drop oldest when over cap. O(1) amortized
      // because shift() runs only once per overflow.
      while (eventLog.length > LIVE_STATUS_LOG_CAP) eventLog.shift();
      const state = selectStatus(eventLog);
      if (!state) {
        lastLine = null;
        return;
      }
      const line = renderStatusLine(state, ctx, templates);
      if (line === null || line === lastLine) return;
      lastLine = line;
      try {
        opts.strategy.renderStatus({ line, state } as StatusUpdate);
      } catch (err) {
        opts.strategy._onError?.(err instanceof Error ? err : new Error(String(err)), event);
      }
    }),
    ...subscribeRunEndFlush(dispatcher, opts.flushOn, handle),
  );
  return handle;
}
