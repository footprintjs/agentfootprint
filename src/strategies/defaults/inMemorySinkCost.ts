/**
 * `inMemorySinkCost()` — default CostStrategy.
 *
 * Pattern: Strategy. In-process accumulator. Same role as InMemoryStore
 *          for memory-providers.
 * Role:    Tier-1 fallback — accumulate cost ticks in a process-local
 *          array. Consumer reads via `getTicks()` or hooks `onRecord`
 *          for streaming. Vendor-free.
 *
 * Use when:
 *   - Tests / CI ("what cost did this run accrue?")
 *   - Local dev before billing integration
 *   - Tier-1 of compose chains (`compose([inMemorySink(), stripeBilling()])`
 *     so test assertions can read ticks while production also ships)
 *
 * Don't use when: process is long-running with high cost-tick volume —
 * the buffer grows unbounded. Add a `maxTicks` cap (drops oldest) or
 * pair with a streaming strategy (`stripeBilling`, `webhook`).
 */

import type { CostStrategy, CostTick } from '../types.js';

export interface InMemorySinkCostOptions {
  /**
   * Optional streaming hook called per tick. Useful for piping the
   * accumulator into a custom sink without writing a full strategy.
   */
  readonly onRecord?: (tick: CostTick) => void;
  /**
   * Maximum ticks to retain in the buffer. When exceeded, the OLDEST
   * tick is dropped (FIFO). Default `Infinity` — no cap.
   */
  readonly maxTicks?: number;
}

/**
 * Extended interface — the in-memory sink also exposes the buffer
 * for read-back. Strategies aren't required to do this; this one
 * does because that IS its purpose (accumulate for inspection).
 */
export interface InMemorySinkCostStrategy extends CostStrategy {
  /** Snapshot of the buffered ticks. O(n) per call — for cheap
   *  polling use `getTicksCount()` + `getTicksSince(idx)`. */
  readonly getTicks: () => readonly CostTick[];
  /** Cheap O(1) read for "did anything new arrive?" polling. */
  readonly getTicksCount: () => number;
  /** Incremental read — returns ticks WITH index >= `idx`. Lets a
   *  dashboard poll cheaply by tracking its last-seen index. */
  readonly getTicksSince: (idx: number) => readonly CostTick[];
  /** Drop all buffered ticks. */
  readonly clear: () => void;
}

export function inMemorySinkCost(opts: InMemorySinkCostOptions = {}): InMemorySinkCostStrategy {
  const buffer: CostTick[] = [];
  const cap = opts.maxTicks ?? Infinity;
  return {
    name: 'in-memory-sink',
    capabilities: { streaming: true, enforcement: false },
    recordCost(tick: CostTick): void {
      buffer.push(tick);
      // FIFO eviction when over cap.
      while (buffer.length > cap) buffer.shift();
      opts.onRecord?.(tick);
    },
    getTicks() {
      return buffer.slice();
    },
    getTicksCount() {
      return buffer.length;
    },
    getTicksSince(idx: number) {
      // Clamp negative / out-of-range. `slice` handles bounds.
      return buffer.slice(Math.max(0, idx));
    },
    clear() {
      buffer.length = 0;
    },
  };
}
