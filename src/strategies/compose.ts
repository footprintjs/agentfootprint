/**
 * `compose([...])` — fan-out combinator.
 *
 * Pattern: Composite. Same shape as React's children array, RxJS's
 *          `merge`, OTel's `MultiSpanProcessor`. Pass an array of
 *          strategies; get back a single strategy that fan-outs each
 *          call to every child.
 *
 * Use when:
 *   - Multi-vendor pipelines (`compose([datadog(), otel(), console()])`)
 *   - Test instrumentation alongside production sink
 *     (`compose([inMemorySink(), stripeBilling()])`) so test assertions
 *     can read ticks while production also ships
 *   - Tier-staging — local dev mirrors what production sees
 *
 * Per-child error isolation: if one child's `exportEvent` throws, the
 * other children still receive the event. The throwing child's
 * `_onError` is called (if present); otherwise the error is logged
 * via `console.warn` once. One bad sink never breaks the chain.
 *
 * Capabilities are OR-ed across children — if any child supports a
 * capability, the composite reports it as supported. The dispatcher
 * uses this to decide whether to bother building event objects at all.
 *
 * Idempotent operations:
 *   - `flush()` — calls every child's `flush()` (sync or async)
 *     concurrently, awaits all
 *   - `stop()` — calls every child's `stop()` once, in order; failures
 *     in one child don't block the others
 */

import type { AgentfootprintEvent } from '../events/registry.js';
import type {
  ObservabilityStrategy,
  CostStrategy,
  CostTick,
  LiveStatusStrategy,
  StatusUpdate,
  LensStrategy,
  LensUpdate,
} from './types.js';

// ─── Internal helpers ────────────────────────────────────────────────

/** Run `cb()` for every child; isolate errors via the child's
 *  `_onError` or a single `console.warn`. */
function safeForEach<T extends { _onError?: (err: Error) => void }>(
  children: readonly T[],
  cb: (c: T) => void,
): void {
  for (const child of children) {
    try {
      cb(child);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (child._onError) {
        try {
          child._onError(e);
        } catch {
          // Even _onError can throw; final fallback is silent drop —
          // we MUST NOT propagate to the caller (passive recorder rule).
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[compose] child threw and has no _onError:', e.message);
      }
    }
  }
}

/** OR-merge a capability bag across children. Generic over the
 *  concrete capability type — the runtime walk treats every entry as
 *  `boolean | undefined` regardless of the typed shape. */
function mergeCaps<C>(children: readonly { capabilities: C }[]): C {
  const merged: Record<string, boolean | undefined> = {};
  for (const c of children) {
    for (const [k, v] of Object.entries(c.capabilities as Record<string, unknown>)) {
      if (v === true) merged[k] = true;
    }
  }
  return merged as C;
}

/** Run every child's optional `flush` concurrently. */
async function flushAll(children: readonly { flush?(): void | Promise<void> }[]): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const c of children) {
    if (!c.flush) continue;
    try {
      const result = c.flush();
      if (result instanceof Promise) promises.push(result.catch(() => {}));
    } catch {
      // ignore — passive recorder rule
    }
  }
  if (promises.length > 0) await Promise.all(promises);
}

function stopAll(children: readonly { stop?(): void }[]): void {
  for (const c of children) {
    if (!c.stop) continue;
    try {
      c.stop();
    } catch {
      // ignore — passive recorder rule
    }
  }
}

// ─── Composite factories — one per strategy kind ─────────────────────

/**
 * Compose multiple ObservabilityStrategies into a single fan-out.
 *
 * @example
 *   const all = composeObservability([
 *     consoleObservability(),
 *     datadogObservability({ apiKey }),
 *     otelObservability(tracer),
 *   ]);
 */
export function composeObservability(
  children: readonly ObservabilityStrategy[],
): ObservabilityStrategy {
  return {
    name: 'compose',
    capabilities: mergeCaps(children),
    exportEvent(event: AgentfootprintEvent): void {
      safeForEach(children, (c) => c.exportEvent(event));
    },
    flush: () => flushAll(children),
    stop: () => stopAll(children),
  };
}

/** Compose CostStrategies. */
export function composeCost(children: readonly CostStrategy[]): CostStrategy {
  return {
    name: 'compose',
    capabilities: mergeCaps(children),
    recordCost(tick: CostTick): void {
      safeForEach(children, (c) => c.recordCost(tick));
    },
    flush: () => flushAll(children),
    stop: () => stopAll(children),
  };
}

/** Compose LiveStatusStrategies. */
export function composeLiveStatus(children: readonly LiveStatusStrategy[]): LiveStatusStrategy {
  return {
    name: 'compose',
    capabilities: mergeCaps(children),
    renderStatus(update: StatusUpdate): void {
      safeForEach(children, (c) => c.renderStatus(update));
    },
    flush: () => flushAll(children),
    stop: () => stopAll(children),
  };
}

/** Compose LensStrategies. */
export function composeLens(children: readonly LensStrategy[]): LensStrategy {
  return {
    name: 'compose',
    capabilities: mergeCaps(children),
    renderGraph(update: LensUpdate): void {
      safeForEach(children, (c) => c.renderGraph(update));
    },
    flush: () => flushAll(children),
    stop: () => stopAll(children),
  };
}
