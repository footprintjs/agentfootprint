/**
 * Property tests — listener lifecycle invariants (backlog #11a).
 *
 * For ANY randomized interleaving of on / once / unsubscribe / abort /
 * dispatch / removeAllListeners, the dispatcher must uphold:
 *
 *   1. `listenerCount()` exactly matches an independently-tracked model
 *      of live subscriptions (no phantom retention, no lost listeners).
 *   2. The internal Maps retain NO empty buckets (bounded-leak guarantee).
 *   3. No operation sequence ever throws.
 *
 * Seeded PRNG — failures are reproducible by seed.
 */

import { describe, it, expect } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
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

/** Mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBSCRIPTION_KEYS = [
  'agentfootprint.agent.turn_start',
  'agentfootprint.agent.turn_end',
  'agentfootprint.context.injected',
  'agentfootprint.stream.llm_start',
  'agentfootprint.agent.*',
  'agentfootprint.context.*',
  '*',
] as const;

const DISPATCH_TYPES = [
  'agentfootprint.agent.turn_start',
  'agentfootprint.agent.turn_end',
  'agentfootprint.context.injected',
  'agentfootprint.stream.llm_start',
] as const;

interface LiveSub {
  readonly unsub: () => void;
  readonly key: string;
  readonly once: boolean;
  readonly controller?: AbortController;
}

function internals(d: EventDispatcher): {
  byType: Map<string, Set<unknown>>;
  domainWildcards: Map<string, Set<unknown>>;
} {
  return d as unknown as {
    byType: Map<string, Set<unknown>>;
    domainWildcards: Map<string, Set<unknown>>;
  };
}

/** Would a dispatched event type fire a subscription registered under `key`? */
function matches(key: string, eventType: string): boolean {
  if (key === '*') return true;
  if (key.endsWith('.*')) return eventType.startsWith(key.slice(0, -1));
  return key === eventType;
}

function assertInvariants(d: EventDispatcher, model: LiveSub[], seed: number, step: number): void {
  const label = `seed=${seed} step=${step}`;
  expect(d.listenerCount(), `listenerCount mismatch (${label})`).toBe(model.length);
  for (const [key, bucket] of internals(d).byType) {
    expect(bucket.size, `empty typed bucket retained for '${key}' (${label})`).toBeGreaterThan(0);
  }
  for (const [key, bucket] of internals(d).domainWildcards) {
    expect(
      bucket.size,
      `empty domain-wildcard bucket retained for '${key}' (${label})`,
    ).toBeGreaterThan(0);
  }
}

describe('Property — lifecycle invariants under random op interleavings', () => {
  it('listenerCount matches the model and no empty buckets are retained (50 seeds × 200 ops)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rand = prng(seed);
      const d = new EventDispatcher();
      let model: LiveSub[] = [];

      for (let step = 0; step < 200; step++) {
        const roll = rand();

        if (roll < 0.35) {
          // Subscribe (on or once, sometimes with a signal).
          const key = SUBSCRIPTION_KEYS[Math.floor(rand() * SUBSCRIPTION_KEYS.length)];
          const once = rand() < 0.3;
          const withSignal = rand() < 0.5;
          const controller = withSignal ? new AbortController() : undefined;
          const opts = controller ? { signal: controller.signal } : undefined;
          const on = (
            d as unknown as {
              on(t: string, l: () => void, o?: { signal?: AbortSignal }): () => void;
              once(t: string, l: () => void, o?: { signal?: AbortSignal }): () => void;
            }
          )[once ? 'once' : 'on'].bind(d);
          const unsub = on(key, () => {}, opts);
          model.push({ unsub, key, once, controller });
        } else if (roll < 0.55 && model.length > 0) {
          // Manual unsubscribe of a random live subscription.
          const idx = Math.floor(rand() * model.length);
          model[idx].unsub();
          model.splice(idx, 1);
        } else if (roll < 0.7 && model.length > 0) {
          // Abort a random live subscription that has a controller.
          const withControllers = model.filter((s) => s.controller);
          if (withControllers.length > 0) {
            const victim = withControllers[Math.floor(rand() * withControllers.length)];
            victim.controller!.abort();
            model = model.filter((s) => s !== victim);
          }
        } else if (roll < 0.95) {
          // Dispatch — once-listeners that match the type are consumed.
          const type = DISPATCH_TYPES[Math.floor(rand() * DISPATCH_TYPES.length)];
          d.dispatch({ type, payload: {}, meta: fakeMeta() } as unknown as AgentfootprintEvent);
          model = model.filter((s) => !(s.once && matches(s.key, type)));
        } else {
          // Bulk lifecycle escape hatch.
          d.removeAllListeners();
          model = [];
        }

        assertInvariants(d, model, seed, step);
      }

      // Drain at the end — a full cleanup must always reach zero.
      d.removeAllListeners();
      expect(d.listenerCount()).toBe(0);
      expect(internals(d).byType.size).toBe(0);
      expect(internals(d).domainWildcards.size).toBe(0);
    }
  });

  it('stale unsubscribes and double-aborts never corrupt later state (20 seeds × 100 ops)', () => {
    for (let seed = 100; seed < 120; seed++) {
      const rand = prng(seed);
      const d = new EventDispatcher();
      const graveyard: LiveSub[] = [];
      const model: LiveSub[] = [];

      for (let step = 0; step < 100; step++) {
        const roll = rand();
        if (roll < 0.4) {
          const key = SUBSCRIPTION_KEYS[Math.floor(rand() * SUBSCRIPTION_KEYS.length)];
          const controller = new AbortController();
          const unsub = (
            d as unknown as {
              on(t: string, l: () => void, o?: { signal?: AbortSignal }): () => void;
            }
          ).on(key, () => {}, { signal: controller.signal });
          model.push({ unsub, key, once: false, controller });
        } else if (roll < 0.6 && model.length > 0) {
          const idx = Math.floor(rand() * model.length);
          const dead = model[idx];
          dead.unsub();
          model.splice(idx, 1);
          graveyard.push(dead);
        } else if (graveyard.length > 0) {
          // Replay dead handles — stale unsub + late abort must be no-ops.
          const ghost = graveyard[Math.floor(rand() * graveyard.length)];
          ghost.unsub();
          ghost.controller?.abort();
        }

        assertInvariants(d, model, seed, step);
      }
    }
  });
});
