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
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

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

  it('100k subscribe/release cycles retain ZERO internal storage (listenerCount + bucket maps)', () => {
    const d = new EventDispatcher();
    const inner = d as unknown as {
      byType: Map<string, Set<unknown>>;
      domainWildcards: Map<string, Set<unknown>>;
    };
    for (let i = 0; i < 100_000; i++) {
      const unsub = d.on('agentfootprint.agent.turn_start', () => {});
      const unsubWild = d.on('agentfootprint.context.*', () => {});
      unsub();
      unsubWild();
    }
    expect(d.listenerCount()).toBe(0);
    // Bounded-leak guarantee: emptied buckets are PRUNED, not retained.
    expect(inner.byType.size).toBe(0);
    expect(inner.domainWildcards.size).toBe(0);
  });
});

// ─── Load test (backlog #11a) — the bounded-leak guarantee end-to-end ──
//
// A long-lived server reuses ONE Agent across many requests. Each request
// registers per-run listeners scoped by an AbortSignal and aborts after
// the run. The dispatcher's retained listener count must stay BOUNDED at
// the pre-loop baseline — independent of how many runs have happened.

describe('Load — 1,000 sequential agent.run() with per-run { signal } subscriptions', () => {
  it('dispatcher listener count stays bounded at the baseline', async () => {
    const provider = mock({ respond: () => ({ content: 'done', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' }).system('s').build();
    const dispatcher = (
      agent as unknown as {
        dispatcher: EventDispatcher & {
          byType: Map<string, Set<unknown>>;
          domainWildcards: Map<string, Set<unknown>>;
        };
      }
    ).dispatcher;

    const baseline = agent.listenerCount();
    let peak = 0;
    let observed = 0;

    for (let i = 0; i < 1000; i++) {
      // Per-run subscriptions, request-scoped via AbortSignal — the
      // documented server pattern.
      const ac = new AbortController();
      agent.on(
        '*',
        () => {
          observed++;
        },
        { signal: ac.signal },
      );
      agent.on('agentfootprint.agent.turn_end', () => {}, { signal: ac.signal });
      agent.once('agentfootprint.agent.turn_start', () => {}, { signal: ac.signal });

      await agent.run({ message: `m${i}` });
      ac.abort();

      peak = Math.max(peak, agent.listenerCount());
      // Bounded after EVERY run — not just at the end.
      expect(agent.listenerCount()).toBe(baseline);
    }

    // Per-run listeners really fired (subscriptions were live during runs).
    expect(observed).toBeGreaterThan(0);
    // Peak retention = baseline + the ≤3 in-flight per-run listeners.
    expect(peak).toBeLessThanOrEqual(baseline + 3);
    // Internal bucket maps hold no leftovers beyond live baseline buckets.
    const liveBuckets = dispatcher.byType.size + dispatcher.domainWildcards.size;
    expect(dispatcher.listenerCount()).toBe(baseline);
    expect(liveBuckets).toBeLessThanOrEqual(baseline);
  }, 120_000);

  it('removeAllListeners() between runs is an equivalent escape hatch (no signal needed)', async () => {
    const provider = mock({ respond: () => ({ content: 'done', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' }).system('s').build();

    // Consumer that can't thread signals: subscribe per-run, bulk-drop after.
    for (let i = 0; i < 100; i++) {
      agent.on('*', () => {});
      agent.on('agentfootprint.agent.turn_end', () => {});
      await agent.run({ message: `m${i}` });
      agent.removeAllListeners();
      expect(agent.listenerCount()).toBe(0);
    }
  }, 60_000);
});

describe('ROI — dispatch cost bounded by listener count', () => {
  it('one dispatch invokes every matching listener once and no unrelated listener', () => {
    const event = {
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0, userPrompt: '' },
      meta: meta(),
    } as AgentfootprintEvent;
    for (const size of [10, 100, 1000]) {
      const dispatcher = new EventDispatcher();
      const delivered = Array<number>(size).fill(0);
      let unrelated = 0;
      for (let i = 0; i < size; i++) {
        dispatcher.on('agentfootprint.agent.turn_start', () => {
          delivered[i]! += 1;
        });
        dispatcher.on('agentfootprint.agent.turn_end', () => {
          unrelated += 1;
        });
      }
      dispatcher.dispatch(event);
      expect(delivered).toEqual(Array<number>(size).fill(1));
      expect(unrelated).toBe(0);
    }
  });
});
