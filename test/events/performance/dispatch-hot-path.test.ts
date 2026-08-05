/**
 * Performance tests — dispatcher hot path.
 *
 * Enforces the north-star design targets:
 *   - hasListenersFor(): O(1), a handful of nanoseconds per call
 *   - Dispatch with no listeners: the fast path, no allocation (best-effort)
 *   - Dispatch to N listeners: linear in N, never quadratic
 *   - subscribe/unsubscribe: constant cost, nothing accumulates
 *
 * The purpose is catching 10×+ regressions, not micro-benchmarking absolute
 * speed — so the budgets are stated as REFERENCE UNITS (a fixed slab of CPU
 * work timed in this same process, see test/helpers/perf.ts) or as ratios
 * between two runs. A nanosecond target hard-coded in the source measures the
 * runner's spare capacity; these forms measure the dispatcher.
 */

import { describe, it } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { expectScalesLinearly, expectWithinReferenceUnits, measure } from '../../helpers/perf.js';

function meta() {
  return {
    wallClockMs: 0,
    runOffsetMs: 0,
    runtimeStageId: 's',
    subflowPath: [] as string[],
    compositionPath: [] as string[],
    runId: 'r',
  };
}

function makeEvent(): AgentfootprintEvent {
  return {
    type: 'agentfootprint.agent.turn_start',
    payload: { turnIndex: 0, userPrompt: 'q' },
    meta: meta(),
  } as AgentfootprintEvent;
}

/** Run `fn` `iters` times (after a warmup) and return the total milliseconds. */
function msFor(iters: number, fn: () => void): number {
  // Warmup to stabilize JIT
  for (let i = 0; i < Math.min(iters, 1000); i++) fn();
  return measure(() => {
    for (let i = 0; i < iters; i++) fn();
  });
}

describe('perf — no-listener fast path', () => {
  it(
    'hasListenersFor over 100k calls costs a few reference units',
    { timeout: 30_000, retry: 2 },
    async () => {
      // 100k calls inside 50 reference units is ~500ns/call on a quiet machine
      // and stays honest on a loaded one, because the unit grows with the load.
      // The design target is ~20ns; the envelope is wide on purpose — this is a
      // regression guard, not a benchmark.
      const d = new EventDispatcher();
      await expectWithinReferenceUnits(
        () => msFor(100_000, () => d.hasListenersFor('agentfootprint.agent.turn_start')),
        50,
        'hasListenersFor must stay a map probe',
      );
    },
  );

  it(
    'dispatch with no listeners over 100k calls costs a few reference units',
    { timeout: 30_000, retry: 2 },
    async () => {
      // 100k dispatches inside 100 reference units — the fast path returns
      // before building anything.
      const d = new EventDispatcher();
      const e = makeEvent();
      await expectWithinReferenceUnits(
        () => msFor(100_000, () => d.dispatch(e)),
        100,
        'the no-listener path must not allocate per dispatch',
      );
    },
  );
});

describe('perf — dispatch with listeners', () => {
  it(
    'dispatch to 1 listener over 50k calls costs a bounded number of reference units',
    { timeout: 30_000, retry: 2 },
    async () => {
      const d = new EventDispatcher();
      d.on('agentfootprint.agent.turn_start', () => {});
      const e = makeEvent();
      await expectWithinReferenceUnits(
        () => msFor(50_000, () => d.dispatch(e)),
        250,
        'one-listener dispatch must stay a direct call',
      );
    },
  );

  it(
    'dispatch to 1000 listeners costs ~100× dispatch to 10, not 10000×',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The claim is linearity in listener count: dispatch walks the list once.
      // A copy-per-listener or a re-sort would show up as a quadratic curve.
      const dispatchTo = (listeners: number) => {
        const d = new EventDispatcher();
        for (let i = 0; i < listeners; i++) d.on('agentfootprint.agent.turn_start', () => {});
        const e = makeEvent();
        msFor(1_000, () => d.dispatch(e));
      };
      await expectScalesLinearly({
        small: () => dispatchTo(10),
        large: () => dispatchTo(1000),
        scale: 100,
        why: 'dispatch must be linear in listener count',
      });
    },
  );
});

describe('perf — subscribe/unsubscribe cycle', () => {
  it(
    'subscribe/unsubscribe stays constant-cost as cycles pile up',
    { timeout: 30_000, retry: 2 },
    async () => {
      // Ten times the cycles, ten times the cost. If unsubscribe left anything
      // behind — a tombstone, a growing array — the later cycles would get
      // steadily more expensive and this ratio would blow out.
      const cycle = (times: number) => {
        const d = new EventDispatcher();
        for (let i = 0; i < times; i++) {
          const unsub = d.on('agentfootprint.agent.turn_start', () => {});
          unsub();
        }
      };
      await expectScalesLinearly({
        small: () => cycle(10_000),
        large: () => cycle(100_000),
        scale: 10,
        why: 'unsubscribe must leave nothing behind for the next subscribe to walk',
      });
    },
  );
});
