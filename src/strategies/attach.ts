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

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';

import type { EventDispatcher, Unsubscribe } from '../events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventType } from '../events/registry.js';
import type {
  ObservabilityStrategy,
  CostStrategy,
  CostTick,
  LiveStatusStrategy,
  StatusUpdate,
  CommonStrategyOptions,
  ObservabilityTier,
  DetachOptions,
} from './types.js';
import {
  selectThinkingState,
  renderThinkingLine,
  defaultThinkingTemplates,
  type ThinkingTemplates,
} from '../recorders/observability/thinking/thinkingTemplates.js';
// Registry-lookup helpers (`getObservabilityStrategy` etc.) are
// defined in `./registry.js` and used by consumers via the
// `enable.*({ vendor, config })` path elsewhere — not used in the
// current attach() implementations, which take `opts.strategy` directly.

/**
 * Sentinel returned when consumer calls `enable.X()` without supplying
 * a strategy or vendor. We DON'T auto-default — that would be an
 * unwelcome opinion. Consumer chose to call `enable.X` but didn't hand
 * us anywhere to ship; just no-op silently and return a stoppable
 * unsubscribe so the call site stays composable.
 */
const NOOP_UNSUBSCRIBE: Unsubscribe = (): void => undefined;

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

let detachExecutorSingleton: import('footprintjs').FlowChartExecutor | undefined;

/** Lazy-import a shared `FlowChartExecutor` we use purely as the
 *  bare-executor entry point for `detachAndForget` / `detachAndJoinLater`.
 *  No chart actually runs through it — we just need its detach methods. */
async function getDetachExecutor(): Promise<import('footprintjs').FlowChartExecutor> {
  if (detachExecutorSingleton) return detachExecutorSingleton;
  const fp = await import('footprintjs');
  // Trivial host chart — never run, just satisfies the constructor.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noopHostStage = async (): Promise<void> => {};
  const noopChart = fp.flowChart('agentfootprint:detach:host', noopHostStage, 'host').build();
  detachExecutorSingleton = new fp.FlowChartExecutor(noopChart);
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
 * The detached path is async-loaded — the executor singleton is built
 * on first call so consumers who don't enable detach pay zero cost.
 */
function buildEventHandler(
  detach: DetachOptions | undefined,
  args: DetachRouterArgs,
): (event: unknown) => void {
  if (!detach) {
    // Sync path — current behavior.
    return (event) => {
      try {
        args.work(event);
      } catch (err) {
        args.onError?.(err instanceof Error ? err : new Error(String(err)), event);
      }
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

  return (event) => {
    // Lazy-resolve the executor. The Promise here is fire-and-forget
    // itself — we never await it, so the agent loop returns sync. Any
    // error from the import OR the schedule call routes to onError.
    getDetachExecutor()
      .then((exec) => {
        if (mode === 'forget') {
          exec.detachAndForget(detach.driver, wrapperChart, event);
        } else {
          const handle = exec.detachAndJoinLater(detach.driver, wrapperChart, event);
          onHandle!(handle);
        }
      })
      .catch((err: unknown) => {
        args.onError?.(err instanceof Error ? err : new Error(String(err)), event);
      });
  };
}

// `resolveStrategy` (vendor-registry lookup helper) is reserved for
// the `enable.*({ vendor, config })` API path — currently the
// `enable.*({ strategy })` path is the only one used in production,
// so no helper is needed here. Re-introduce when the vendor-config
// path lands.

// ─── Observability ───────────────────────────────────────────────────

export interface ObservabilityEnableOptions extends CommonStrategyOptions {
  /** Cost-of-on knob. `'minimal'` → only error + lifecycle events.
   *  `'standard'` → most domains. `'firehose'` → every event including
   *  per-token streams. Default `'standard'`. */
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
): Unsubscribe {
  const strategy = opts.strategy;
  // Consumer chose to call enable.observability() but didn't supply
  // a strategy. Don't auto-default — that imposes an opinion. Just
  // no-op so the call site stays composable.
  if (!strategy) return NOOP_UNSUBSCRIBE;
  strategy.validate?.();
  const tierFilter = TIER_FILTER[opts.tier ?? 'standard'];
  const sampleRate = opts.sampleRate ?? 1;
  const relevant = strategy.relevantEventTypes
    ? new Set<AgentfootprintEventType>(strategy.relevantEventTypes)
    : null;

  // Build the event handler ONCE per attach call. Sync if no
  // `opts.detach`; otherwise schedules on the driver so the agent
  // loop never blocks on slow exporters.
  const handle = buildEventHandler(opts.detach, {
    work: (event) => strategy.exportEvent(event as AgentfootprintEvent),
    onError: (err, event) => strategy._onError?.(err, event as AgentfootprintEvent),
  });

  return dispatcher.on('*', (event: AgentfootprintEvent) => {
    if (!tierFilter(event.type)) return;
    if (relevant && !relevant.has(event.type)) return;
    if (sampleRate < 1 && Math.random() > sampleRate) return;
    handle(event);
  });
}

// ─── Cost ────────────────────────────────────────────────────────────

export interface CostEnableOptions extends CommonStrategyOptions {
  readonly strategy?: CostStrategy;
}

/**
 * Subscribe to `agentfootprint.cost.tick` events, project payload into
 * the canonical `CostTick` shape, hand to strategy.
 */
export function attachCostStrategy(
  dispatcher: EventDispatcher,
  opts: CostEnableOptions = {},
): Unsubscribe {
  const strategy = opts.strategy;
  if (!strategy) return NOOP_UNSUBSCRIBE;
  strategy.validate?.();

  // Cost strategy detach mirrors observability — sync by default,
  // schedules on the driver when `opts.detach` is set. Useful when
  // `recordCost` does heavy work (per-tick DB write, vendor budget
  // API, etc.).
  const handle = buildEventHandler(opts.detach, {
    work: (tickInput) => strategy.recordCost(tickInput as CostTick),
    onError: (err, tickInput) =>
      strategy._onError?.(err, tickInput as unknown as AgentfootprintEvent),
  });

  return dispatcher.on(
    'agentfootprint.cost.tick' as AgentfootprintEventType,
    (event: AgentfootprintEvent) => {
      const p = event.payload as unknown as Record<string, unknown>;
      const tick: CostTick = {
        cumulativeInputTokens: Number(p.cumulativeInputTokens ?? 0),
        cumulativeOutputTokens: Number(p.cumulativeOutputTokens ?? 0),
        cumulativeCostUsd: Number(p.cumulativeCostUsd ?? 0),
        recentInputTokens: Number(p.recentInputTokens ?? 0),
        recentOutputTokens: Number(p.recentOutputTokens ?? 0),
        recentCostUsd: Number(p.recentCostUsd ?? 0),
        model: String(p.model ?? 'unknown'),
        ...(typeof p.iteration === 'number' ? { iteration: p.iteration } : {}),
        ...(typeof p.runtimeStageId === 'string' ? { runtimeStageId: p.runtimeStageId } : {}),
      };
      handle(tick);
    },
  );
}

// ─── Live status ─────────────────────────────────────────────────────

export interface LiveStatusEnableOptions extends CommonStrategyOptions {
  readonly strategy: LiveStatusStrategy; // required — consumer must wire UI
  /** Override the bundled English thinking templates with locale /
   *  per-tool / per-skill overrides. Same shape as
   *  `agent.thinkingTemplates(...)`. */
  readonly templates?: ThinkingTemplates;
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
 *  enough that `selectThinkingState` always sees the relevant recent
 *  history. */
const LIVE_STATUS_LOG_CAP = 1000;

export function attachLiveStatusStrategy(
  dispatcher: EventDispatcher,
  opts: LiveStatusEnableOptions,
): Unsubscribe {
  opts.strategy.validate?.();
  const templates = { ...defaultThinkingTemplates, ...(opts.templates ?? {}) };
  const ctx = { appName: opts.appName ?? 'Agent' };
  const eventLog: AgentfootprintEvent[] = [];
  let lastLine: string | null = null;

  return dispatcher.on('*', (event: AgentfootprintEvent) => {
    eventLog.push(event);
    // Sliding-window — drop oldest when over cap. O(1) amortized
    // because shift() runs only once per overflow.
    while (eventLog.length > LIVE_STATUS_LOG_CAP) eventLog.shift();
    const state = selectThinkingState(eventLog);
    if (!state) {
      lastLine = null;
      return;
    }
    const line = renderThinkingLine(state, ctx, templates);
    if (line === null || line === lastLine) return;
    lastLine = line;
    try {
      opts.strategy.renderStatus({ line, state } as StatusUpdate);
    } catch (err) {
      opts.strategy._onError?.(err instanceof Error ? err : new Error(String(err)), event);
    }
  });
}
