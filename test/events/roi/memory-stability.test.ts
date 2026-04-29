/**
 * ROI tests — cost / memory stability.
 *
 * Verifies the dispatcher doesn't leak memory across long-lived runs.
 * If we leak: long-running chatbots degrade. If we don't leak: production
 * teams can reuse a dispatcher across thousands of turns safely.
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

describe("ROI — listener lifecycle doesn't leak", () => {
  it('100k subscribe/unsubscribe cycles result in zero residual listeners', () => {
    const d = new EventDispatcher();
    for (let i = 0; i < 100_000; i++) {
      const unsub = d.on('agentfootprint.agent.turn_start', () => {});
      unsub();
    }
    // After every unsub, the map bucket should be empty.
    expect(d.hasListenersFor('agentfootprint.agent.turn_start')).toBe(false);
  });

  it('AbortSignal.abort() cleanly removes the listener', () => {
    const d = new EventDispatcher();
    for (let i = 0; i < 1000; i++) {
      const ac = new AbortController();
      d.on('agentfootprint.agent.turn_start', () => {}, { signal: ac.signal });
      ac.abort();
    }
    expect(d.hasListenersFor('agentfootprint.agent.turn_start')).toBe(false);
  });

  it('once-listeners auto-clean after firing', () => {
    const d = new EventDispatcher();
    for (let i = 0; i < 10_000; i++) {
      d.once('agentfootprint.agent.turn_start', () => {});
    }
    d.dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0, userPrompt: '' },
      meta: meta(),
    } as AgentfootprintEvent);
    expect(d.hasListenersFor('agentfootprint.agent.turn_start')).toBe(false);
  });
});

describe('ROI — dispatch cost bounded by listener count', () => {
  it('dispatch to N listeners scales linearly (no hidden O(N²))', () => {
    const d10 = new EventDispatcher();
    const d100 = new EventDispatcher();
    const d1000 = new EventDispatcher();

    for (let i = 0; i < 10; i++) d10.on('agentfootprint.agent.turn_start', () => {});
    for (let i = 0; i < 100; i++) d100.on('agentfootprint.agent.turn_start', () => {});
    for (let i = 0; i < 1000; i++) d1000.on('agentfootprint.agent.turn_start', () => {});

    const e = {
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0, userPrompt: '' },
      meta: meta(),
    } as AgentfootprintEvent;

    function timeMs(fn: () => void, iters: number): number {
      for (let i = 0; i < Math.min(iters, 1000); i++) fn(); // warmup
      const start = performance.now();
      for (let i = 0; i < iters; i++) fn();
      return performance.now() - start;
    }

    const t10 = timeMs(() => d10.dispatch(e), 5_000);
    const t100 = timeMs(() => d100.dispatch(e), 5_000);
    const t1000 = timeMs(() => d1000.dispatch(e), 1_000);

    // 100x listeners should NOT take 10_000x time — enforce O(N).
    // Ratio of per-op costs should be ≈ 1:10:100 (±generous envelope).
    const perOp10 = t10 / 5_000;
    const perOp100 = t100 / 5_000;
    const perOp1000 = t1000 / 1_000;

    // 100→10 ratio should be <100x (linear), certainly <1000x (quadratic)
    expect(perOp100 / perOp10).toBeLessThan(100);
    expect(perOp1000 / perOp100).toBeLessThan(100);
  });
});
