/**
 * Unit tests — EventDispatcher listener lifecycle (backlog #11a).
 *
 * Covers:
 *   removeAllListeners(), listenerCount(), once({ signal }), abort-handler
 *   detach on every removal path, empty-bucket pruning (bounded-leak
 *   guarantee), removal safety during dispatch (off / unsubscribe /
 *   removeAllListeners mid-flight), and stale-handle / hostile-key safety.
 *
 * Performance/load counterparts live in test/events/roi/memory-stability.test.ts
 * (the 1,000-sequential-agent-runs leak test) — the dispatch hot path with
 * pruning is exercised by test/events/performance/dispatch-hot-path.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { EventMeta } from '../../../src/events/types.js';

function fakeMeta(): EventMeta {
  return {
    wallClockMs: 0,
    runOffsetMs: 0,
    runtimeStageId: 'stage#0',
    subflowPath: [],
    compositionPath: [],
    runId: 'run-1',
  };
}

function makeEvent<K extends keyof AgentfootprintEventMap>(
  type: K,
  payload: AgentfootprintEventMap[K]['payload'],
): AgentfootprintEventMap[K] {
  return { type, payload, meta: fakeMeta() } as AgentfootprintEventMap[K];
}

const turnStart = () =>
  makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' });

/** Reach into the dispatcher's private buckets for bounded-leak assertions. */
function internals(d: EventDispatcher): {
  byType: Map<string, Set<unknown>>;
  domainWildcards: Map<string, Set<unknown>>;
  allWildcards: Set<unknown>;
} {
  return d as unknown as {
    byType: Map<string, Set<unknown>>;
    domainWildcards: Map<string, Set<unknown>>;
    allWildcards: Set<unknown>;
  };
}

// ─── removeAllListeners ──────────────────────────────────────────────

describe('EventDispatcher — removeAllListeners', () => {
  it('drops typed, domain-wildcard, and all-wildcard listeners in one call', () => {
    const d = new EventDispatcher();
    const typed = vi.fn();
    const domain = vi.fn();
    const all = vi.fn();
    d.on('agentfootprint.agent.turn_start', typed);
    d.on('agentfootprint.agent.*', domain);
    d.on('*', all);

    d.removeAllListeners();
    d.dispatch(turnStart());

    expect(typed).not.toHaveBeenCalled();
    expect(domain).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
    expect(d.listenerCount()).toBe(0);
    expect(d.hasListenersFor('agentfootprint.agent.turn_start')).toBe(false);
  });

  it('leaves the internal maps with zero entries (no empty-Set retention)', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.agent.turn_start', () => {});
    d.on('agentfootprint.context.injected', () => {});
    d.on('agentfootprint.stream.*', () => {});
    d.on('*', () => {});

    d.removeAllListeners();

    expect(internals(d).byType.size).toBe(0);
    expect(internals(d).domainWildcards.size).toBe(0);
    expect(internals(d).allWildcards.size).toBe(0);
  });

  it('detaches the abort handler from every subscription AbortSignal', () => {
    const d = new EventDispatcher();
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
    d.on('agentfootprint.agent.turn_start', () => {}, { signal: ac.signal });
    d.on('agentfootprint.agent.*', () => {}, { signal: ac.signal });

    d.removeAllListeners();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('the dispatcher remains fully usable after removeAllListeners', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.agent.turn_start', () => {});
    d.removeAllListeners();

    const fn = vi.fn();
    d.on('agentfootprint.agent.turn_start', fn);
    d.dispatch(turnStart());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.listenerCount()).toBe(1);
  });
});

// ─── listenerCount ───────────────────────────────────────────────────

describe('EventDispatcher — listenerCount', () => {
  it('with no argument returns the total across every bucket', () => {
    const d = new EventDispatcher();
    expect(d.listenerCount()).toBe(0);
    d.on('agentfootprint.agent.turn_start', () => {});
    d.on('agentfootprint.agent.turn_start', () => {});
    d.on('agentfootprint.context.injected', () => {});
    d.on('agentfootprint.stream.*', () => {});
    d.on('*', () => {});
    expect(d.listenerCount()).toBe(5);
  });

  it('with a key returns that exact bucket only (wildcards not folded in)', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.agent.turn_start', () => {});
    d.on('agentfootprint.agent.*', () => {});
    d.on('*', () => {});
    expect(d.listenerCount('agentfootprint.agent.turn_start')).toBe(1);
    expect(d.listenerCount('agentfootprint.agent.*')).toBe(1);
    expect(d.listenerCount('*')).toBe(1);
  });

  it('returns 0 for a key with no subscriptions', () => {
    const d = new EventDispatcher();
    expect(d.listenerCount('agentfootprint.cost.tick')).toBe(0);
    expect(d.listenerCount('agentfootprint.cost.*')).toBe(0);
    expect(d.listenerCount('*')).toBe(0);
  });

  it('tracks unsubscribes immediately', () => {
    const d = new EventDispatcher();
    const unsub = d.on('agentfootprint.agent.turn_start', () => {});
    expect(d.listenerCount()).toBe(1);
    unsub();
    expect(d.listenerCount()).toBe(0);
  });
});

// ─── once({ signal }) ────────────────────────────────────────────────

describe('EventDispatcher — once with AbortSignal', () => {
  it('abort before the event removes the once-listener', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    const ac = new AbortController();
    d.once('agentfootprint.agent.turn_start', fn, { signal: ac.signal });
    ac.abort();
    d.dispatch(turnStart());
    expect(fn).not.toHaveBeenCalled();
    expect(d.listenerCount()).toBe(0);
  });

  it('an already-aborted signal registers nothing', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    const ac = new AbortController();
    ac.abort();
    d.once('agentfootprint.agent.turn_start', fn, { signal: ac.signal });
    expect(d.listenerCount()).toBe(0);
    d.dispatch(turnStart());
    expect(fn).not.toHaveBeenCalled();
  });

  it('fires exactly once, then both listener and abort handler are released', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
    d.once('agentfootprint.agent.turn_start', fn, { signal: ac.signal });

    d.dispatch(turnStart());
    d.dispatch(turnStart());

    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.listenerCount()).toBe(0);
    // Auto-removal after firing detached the signal's abort handler too.
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    // A late abort is a harmless no-op.
    expect(() => ac.abort()).not.toThrow();
  });
});

// ─── Abort-handler detach on every removal path ─────────────────────

describe('EventDispatcher — abort-handler detach (no signal-side accumulation)', () => {
  it('manual unsubscribe removes the abort handler from the signal', () => {
    const d = new EventDispatcher();
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
    const unsub = d.on('agentfootprint.agent.turn_start', () => {}, { signal: ac.signal });
    unsub();
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('off() removes the abort handler from the signal', () => {
    const d = new EventDispatcher();
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
    const fn = (): void => {};
    d.on('agentfootprint.agent.turn_start', fn, { signal: ac.signal });
    d.off('agentfootprint.agent.turn_start', fn);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(d.listenerCount()).toBe(0);
  });

  it('a long-lived never-aborted signal does not accumulate handlers across cycles', () => {
    const d = new EventDispatcher();
    const ac = new AbortController(); // server-wide, never aborted
    const addSpy = vi.spyOn(ac.signal, 'addEventListener');
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
    for (let i = 0; i < 100; i++) {
      const unsub = d.on('agentfootprint.agent.turn_start', () => {}, { signal: ac.signal });
      unsub();
    }
    // Every add was matched by a remove — zero residual abort handlers.
    expect(addSpy).toHaveBeenCalledTimes(100);
    expect(removeSpy).toHaveBeenCalledTimes(100);
    expect(d.listenerCount()).toBe(0);
  });
});

// ─── Empty-bucket pruning (bounded-leak internals) ───────────────────

describe('EventDispatcher — empty-bucket pruning', () => {
  it('unsubscribe prunes the emptied typed bucket from the map', () => {
    const d = new EventDispatcher();
    const unsub = d.on('agentfootprint.agent.turn_start', () => {});
    expect(internals(d).byType.size).toBe(1);
    unsub();
    expect(internals(d).byType.size).toBe(0);
  });

  it('off() prunes the emptied typed bucket', () => {
    const d = new EventDispatcher();
    const fn = (): void => {};
    d.on('agentfootprint.agent.turn_start', fn);
    d.off('agentfootprint.agent.turn_start', fn);
    expect(internals(d).byType.size).toBe(0);
  });

  it('a fired once-listener prunes its bucket during dispatch', () => {
    const d = new EventDispatcher();
    d.once('agentfootprint.agent.turn_start', () => {});
    d.dispatch(turnStart());
    expect(internals(d).byType.size).toBe(0);
  });

  it('signal abort prunes the bucket', () => {
    const d = new EventDispatcher();
    const ac = new AbortController();
    d.on('agentfootprint.agent.turn_start', () => {}, { signal: ac.signal });
    ac.abort();
    expect(internals(d).byType.size).toBe(0);
  });

  it('domain-wildcard buckets are pruned the same way', () => {
    const d = new EventDispatcher();
    const unsub = d.on('agentfootprint.context.*', () => {});
    expect(internals(d).domainWildcards.size).toBe(1);
    unsub();
    expect(internals(d).domainWildcards.size).toBe(0);
  });

  it('does not prune a bucket that still has listeners', () => {
    const d = new EventDispatcher();
    const unsub = d.on('agentfootprint.agent.turn_start', () => {});
    d.on('agentfootprint.agent.turn_start', () => {});
    unsub();
    expect(internals(d).byType.size).toBe(1);
    expect(d.listenerCount('agentfootprint.agent.turn_start')).toBe(1);
  });
});

// ─── Removal safety during dispatch ──────────────────────────────────

describe('EventDispatcher — removal during dispatch', () => {
  it('off() mid-dispatch does not break iteration (snapshot semantics)', () => {
    const d = new EventDispatcher();
    const calls: string[] = [];
    const b = (): void => {
      calls.push('B');
    };
    d.on('agentfootprint.agent.turn_start', () => {
      calls.push('A');
      d.off('agentfootprint.agent.turn_start', b);
    });
    d.on('agentfootprint.agent.turn_start', b);
    d.on('agentfootprint.agent.turn_start', () => {
      calls.push('C');
    });

    // In-flight event: snapshot completes — B still fires this time.
    expect(() => d.dispatch(turnStart())).not.toThrow();
    expect(calls).toEqual(['A', 'B', 'C']);

    // Subsequent event: B is gone.
    d.dispatch(turnStart());
    expect(calls).toEqual(['A', 'B', 'C', 'A', 'C']);
  });

  it('a listener unsubscribing ITSELF mid-dispatch is safe', () => {
    const d = new EventDispatcher();
    const fn = vi.fn(() => {
      unsub();
    });
    const unsub = d.on('agentfootprint.agent.turn_start', fn);
    d.dispatch(turnStart());
    d.dispatch(turnStart());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.listenerCount()).toBe(0);
  });

  it('removeAllListeners() mid-dispatch is safe and total', () => {
    const d = new EventDispatcher();
    const calls: string[] = [];
    d.on('agentfootprint.agent.turn_start', () => {
      calls.push('first');
      d.removeAllListeners();
    });
    d.on('agentfootprint.agent.turn_start', () => {
      calls.push('second');
    });
    d.on('*', () => {
      calls.push('wildcard');
    });

    // The bucket being iterated finishes its snapshot ('second' fires);
    // buckets the dispatch has not reached yet deliver nothing
    // (the '*' bucket was cleared before its snapshot was taken).
    expect(() => d.dispatch(turnStart())).not.toThrow();
    expect(calls).toEqual(['first', 'second']);

    // Everything is gone for subsequent events.
    d.dispatch(turnStart());
    expect(calls).toEqual(['first', 'second']);
    expect(d.listenerCount()).toBe(0);
    expect(internals(d).byType.size).toBe(0);
    expect(internals(d).domainWildcards.size).toBe(0);
  });

  it('a listener added mid-dispatch does not fire for the in-flight event', () => {
    const d = new EventDispatcher();
    const late = vi.fn();
    d.on('agentfootprint.agent.turn_start', () => {
      d.on('agentfootprint.agent.turn_start', late);
    });
    d.dispatch(turnStart());
    expect(late).not.toHaveBeenCalled();
    d.dispatch(turnStart());
    expect(late).toHaveBeenCalledTimes(1);
  });
});

// ─── Security — stale handles & hostile keys ─────────────────────────

describe('EventDispatcher — stale-handle and hostile-key safety', () => {
  it('a stale Unsubscribe after removeAllListeners cannot remove a NEW subscription', () => {
    const d = new EventDispatcher();
    const staleUnsub = d.on('agentfootprint.agent.turn_start', () => {});
    d.removeAllListeners();

    const fn = vi.fn();
    d.on('agentfootprint.agent.turn_start', fn);
    staleUnsub(); // must be a harmless no-op against the new bucket
    d.dispatch(turnStart());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.listenerCount()).toBe(1);
  });

  it('a stale Unsubscribe after pruning cannot delete a re-created bucket', () => {
    const d = new EventDispatcher();
    const staleUnsub = d.on('agentfootprint.agent.turn_start', () => {});
    staleUnsub(); // bucket pruned
    const fn = vi.fn();
    d.on('agentfootprint.agent.turn_start', fn); // NEW bucket under same key
    staleUnsub(); // stale closure references the OLD bucket — no effect
    d.dispatch(turnStart());
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calling an Unsubscribe twice is a no-op', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.agent.turn_start', () => {});
    const unsub = d.on('agentfootprint.agent.turn_start', () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
    expect(d.listenerCount()).toBe(1);
  });

  it('hostile bucket keys (__proto__, constructor) stay in the Map — no pollution', () => {
    const d = new EventDispatcher() as unknown as {
      on(t: string, l: () => void): () => void;
      listenerCount(t?: string): number;
      removeAllListeners(): void;
    };
    d.on('__proto__', () => {});
    d.on('constructor', () => {});
    expect(d.listenerCount('__proto__')).toBe(1);
    expect(d.listenerCount('constructor')).toBe(1);
    // Object.prototype untouched.
    expect(({} as Record<string, unknown>)['__proto__.listener']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, '__proto__.listener')).toBe(
      false,
    );
    d.removeAllListeners();
    expect(d.listenerCount()).toBe(0);
  });
});
