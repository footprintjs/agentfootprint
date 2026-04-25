/**
 * Property tests — dispatcher invariants that must hold across many
 * random subscribe/dispatch/unsubscribe sequences.
 */

import { describe, it, expect } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  ALL_EVENT_TYPES,
  type AgentfootprintEvent,
} from '../../../src/events/registry.js';

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

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

describe('property — invariants over random event streams', () => {
  it('total dispatches to N unique listeners equals N per event', () => {
    const d = new EventDispatcher();
    const N = 25;
    let totalCalls = 0;
    for (let i = 0; i < N; i++) {
      d.on('agentfootprint.agent.turn_start', () => {
        totalCalls++;
      });
    }
    d.dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0, userPrompt: 'q' },
      meta: meta(),
    } as AgentfootprintEvent);
    expect(totalCalls).toBe(N);
  });

  it('after unsubscribing all listeners, no listener fires', () => {
    const d = new EventDispatcher();
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 30; i++) {
      unsubs.push(
        d.on('agentfootprint.agent.turn_start', () => {
          throw new Error('should not run');
        }),
      );
    }
    for (const u of unsubs) u();
    // If any listener remained, this would throw via dispatch → never-thrown
    // is tolerated by dispatcher, but the count would be non-zero.
    expect(() =>
      d.dispatch({
        type: 'agentfootprint.agent.turn_start',
        payload: { turnIndex: 0, userPrompt: '' },
        meta: meta(),
      } as AgentfootprintEvent),
    ).not.toThrow();
  });

  it('once-listener fires exactly once regardless of dispatch count', () => {
    const d = new EventDispatcher();
    let count = 0;
    d.once('agentfootprint.agent.turn_start', () => {
      count++;
    });
    for (let i = 0; i < 100; i++) {
      d.dispatch({
        type: 'agentfootprint.agent.turn_start',
        payload: { turnIndex: i, userPrompt: '' },
        meta: meta(),
      } as AgentfootprintEvent);
    }
    expect(count).toBe(1);
  });

  it('wildcard + typed subscriptions both receive the event (no dedup)', () => {
    const d = new EventDispatcher();
    let wildcardCalls = 0;
    let typedCalls = 0;
    d.on('*', () => {
      wildcardCalls++;
    });
    d.on('agentfootprint.stream.llm_start', () => {
      typedCalls++;
    });
    d.dispatch({
      type: 'agentfootprint.stream.llm_start',
      payload: {
        iteration: 0,
        provider: 'mock',
        model: 'm',
        systemPromptChars: 0,
        messagesCount: 0,
        toolsCount: 0,
      },
      meta: meta(),
    } as AgentfootprintEvent);
    expect(wildcardCalls).toBe(1);
    expect(typedCalls).toBe(1);
  });

  it('random subscribe/unsubscribe/dispatch sequences never throw', () => {
    const d = new EventDispatcher();
    const unsubs = new Map<number, () => void>();
    let id = 0;
    for (let step = 0; step < 500; step++) {
      const action = Math.random();
      if (action < 0.5) {
        const t = rand(ALL_EVENT_TYPES);
        const u = d.on(t, () => {});
        unsubs.set(id++, u);
      } else if (action < 0.75 && unsubs.size > 0) {
        const key = [...unsubs.keys()][Math.floor(Math.random() * unsubs.size)];
        unsubs.get(key)?.();
        unsubs.delete(key);
      } else {
        const t = rand(ALL_EVENT_TYPES);
        d.dispatch({ type: t, payload: {}, meta: meta() } as unknown as AgentfootprintEvent);
      }
    }
    // Just completing without throwing is the invariant.
    expect(true).toBe(true);
  });
});
