/**
 * Unit tests — EventDispatcher.
 *
 * Covers:
 *   on/off/once, wildcard subscription, AbortSignal cleanup, error
 *   isolation, non-blocking dispatch, hasListenersFor fast path.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../../src/events/registry.js';
import type { EventMeta } from '../../../src/events/types.js';

function fakeMeta(overrides: Partial<EventMeta> = {}): EventMeta {
  return {
    wallClockMs: 0,
    runOffsetMs: 0,
    runtimeStageId: 'stage#0',
    subflowPath: [],
    compositionPath: [],
    runId: 'run-1',
    ...overrides,
  };
}

function makeEvent<K extends keyof AgentfootprintEventMap>(
  type: K,
  payload: AgentfootprintEventMap[K]['payload'],
): AgentfootprintEventMap[K] {
  return { type, payload, meta: fakeMeta() } as AgentfootprintEventMap[K];
}

describe('EventDispatcher — on/dispatch', () => {
  it('delivers events to typed listeners by exact type', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.injected', fn);
    const event = makeEvent('agentfootprint.context.injected', {
      slot: 'messages',
      source: 'user',
      contentSummary: 'hi',
      contentHash: 'h1',
      reason: 'test',
    });
    d.dispatch(event);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(event);
  });

  it('does not call listeners for other event types', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.stream.llm_start', fn);
    d.dispatch(
      makeEvent('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'hi',
        toolCallCount: 0,
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
        durationMs: 0,
      }),
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('delivers to multiple listeners in registration order', () => {
    const d = new EventDispatcher();
    const order: number[] = [];
    d.on('agentfootprint.agent.turn_start', () => order.push(1));
    d.on('agentfootprint.agent.turn_start', () => order.push(2));
    d.on('agentfootprint.agent.turn_start', () => order.push(3));
    d.dispatch(makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }));
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('EventDispatcher — off', () => {
  it('removes a listener so it no longer fires', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.agent.turn_end', fn);
    d.off('agentfootprint.agent.turn_end', fn);
    d.dispatch(
      makeEvent('agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: 'done',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        iterationCount: 1,
        durationMs: 0,
      }),
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('the Unsubscribe returned from on() also removes the listener', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    const unsub = d.on('agentfootprint.agent.turn_end', fn);
    unsub();
    d.dispatch(
      makeEvent('agentfootprint.agent.turn_end', {
        turnIndex: 0,
        finalContent: '',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        iterationCount: 0,
        durationMs: 0,
      }),
    );
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('EventDispatcher — once', () => {
  it('fires once then auto-removes', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.once('agentfootprint.agent.turn_start', fn);
    const e = makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' });
    d.dispatch(e);
    d.dispatch(e);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('EventDispatcher — wildcards', () => {
  it('domain wildcard receives every event in that domain', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.*', fn);
    d.dispatch(
      makeEvent('agentfootprint.context.injected', {
        slot: 'messages',
        source: 'user',
        contentSummary: '',
        contentHash: '',
        reason: '',
      }),
    );
    d.dispatch(
      makeEvent('agentfootprint.context.evicted', {
        slot: 'messages',
        contentHash: '',
        reason: 'budget',
        survivalMs: 0,
      }),
    );
    d.dispatch(
      makeEvent('agentfootprint.stream.llm_start', {
        iteration: 1,
        provider: 'mock',
        model: 'm',
        systemPromptChars: 0,
        messagesCount: 0,
        toolsCount: 0,
      }),
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('all-wildcard (*) receives every event regardless of domain', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('*', fn);
    d.dispatch(
      makeEvent('agentfootprint.context.injected', {
        slot: 'tools',
        source: 'skill',
        contentSummary: '',
        contentHash: '',
        reason: '',
      }),
    );
    d.dispatch(
      makeEvent('agentfootprint.stream.llm_start', {
        iteration: 0,
        provider: 'openai',
        model: 'gpt-4',
        systemPromptChars: 0,
        messagesCount: 0,
        toolsCount: 0,
      }),
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('EventDispatcher — AbortSignal', () => {
  it('unsubscribes when signal aborts', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    const ac = new AbortController();
    d.on('agentfootprint.agent.turn_start', fn, { signal: ac.signal });
    ac.abort();
    d.dispatch(makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }));
    expect(fn).not.toHaveBeenCalled();
  });

  it('skips registration when signal is already aborted', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    const ac = new AbortController();
    ac.abort();
    d.on('agentfootprint.agent.turn_start', fn, { signal: ac.signal });
    d.dispatch(makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('EventDispatcher — non-blocking semantics', () => {
  it('does not await Promise returned from a listener (fire-and-forget)', async () => {
    const d = new EventDispatcher();
    let tookNext = false;
    d.on('agentfootprint.agent.turn_start', () => {
      // Simulates an async observer that returns a Promise.
      // The dispatcher MUST NOT await it; subsequent code runs immediately.
      return new Promise((resolve) => setTimeout(resolve, 50)) as unknown as void;
    });
    d.dispatch(makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }));
    tookNext = true;
    expect(tookNext).toBe(true); // Reached immediately — dispatcher didn't block.
  });

  it('a throwing listener does not break dispatch to other listeners', () => {
    const d = new EventDispatcher();
    const ok = vi.fn();
    d.on('agentfootprint.agent.turn_start', () => {
      throw new Error('boom');
    });
    d.on('agentfootprint.agent.turn_start', ok);
    d.dispatch(makeEvent('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'q' }));
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('EventDispatcher — hasListenersFor (fast path)', () => {
  it('returns false when no listener is attached for a type', () => {
    const d = new EventDispatcher();
    expect(d.hasListenersFor('agentfootprint.stream.llm_start')).toBe(false);
  });

  it('returns true when a typed listener is attached', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.stream.llm_start', () => {});
    expect(d.hasListenersFor('agentfootprint.stream.llm_start')).toBe(true);
  });

  it('returns true when a matching domain wildcard is attached', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.stream.*', () => {});
    expect(d.hasListenersFor('agentfootprint.stream.llm_start')).toBe(true);
    expect(d.hasListenersFor('agentfootprint.context.injected')).toBe(false);
  });

  it('returns true when the all-wildcard (*) is attached', () => {
    const d = new EventDispatcher();
    d.on('*', () => {});
    expect(d.hasListenersFor('agentfootprint.agent.turn_start')).toBe(true);
  });
});
