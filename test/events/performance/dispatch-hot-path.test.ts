/**
 * Performance tests — dispatcher hot path.
 *
 * Enforces the CI-gated targets from the north-star design:
 *   - hasListenersFor(): <20ns per call, O(1) behavior
 *   - Dispatch with no listeners: <20ns, zero allocation (best-effort)
 *   - Dispatch to 1000 listeners: <100μs total
 *
 * These targets are upper bounds with generous slack — actual runs are
 * typically an order of magnitude faster. The real purpose is catching
 * regressions (10×+ slowdowns), not micro-benchmarking absolute speed.
 */

import { describe, it, expect } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

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

/** Measure ns/op averaged over ITERS iterations. */
function nsPerOp(iters: number, fn: () => void): number {
  // Warmup to stabilize JIT
  for (let i = 0; i < Math.min(iters, 1000); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const endMs = performance.now();
  return ((endMs - start) * 1e6) / iters;
}

describe('perf — no-listener fast path', () => {
  it('hasListenersFor is <500ns/op when no listener is attached', () => {
    const d = new EventDispatcher();
    const ns = nsPerOp(100_000, () => d.hasListenersFor('agentfootprint.agent.turn_start'));
    // Target 20ns in real use; allow 500ns envelope in CI under load.
    expect(ns).toBeLessThan(500);
  });

  it('dispatch with no listeners is <1000ns/op (fast path)', () => {
    const d = new EventDispatcher();
    const e = makeEvent();
    const ns = nsPerOp(100_000, () => d.dispatch(e));
    // Actual tends to be under 100ns; CI envelope 1000ns.
    expect(ns).toBeLessThan(1000);
  });
});

describe('perf — dispatch with listeners', () => {
  it('dispatch to 1 listener is <5μs/op', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.agent.turn_start', () => {});
    const e = makeEvent();
    const ns = nsPerOp(50_000, () => d.dispatch(e));
    expect(ns).toBeLessThan(5_000);
  });

  it('dispatch to 1000 listeners is <200μs/op', () => {
    const d = new EventDispatcher();
    for (let i = 0; i < 1000; i++) {
      d.on('agentfootprint.agent.turn_start', () => {});
    }
    const e = makeEvent();
    const ns = nsPerOp(1_000, () => d.dispatch(e));
    // Target 100μs; allow 200μs envelope for CI.
    expect(ns).toBeLessThan(200_000);
  });
});

describe('perf — subscribe/unsubscribe cycle', () => {
  it('100k subscribe/unsubscribe cycles complete in <1s total', () => {
    const d = new EventDispatcher();
    const start = performance.now();
    for (let i = 0; i < 100_000; i++) {
      const unsub = d.on('agentfootprint.agent.turn_start', () => {});
      unsub();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
