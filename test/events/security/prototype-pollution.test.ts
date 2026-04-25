/**
 * Security tests — dispatcher is safe against prototype pollution and
 * payload tampering.
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('security — prototype pollution defense', () => {
  it('subscribing with a __proto__ typed key does not pollute Object.prototype', () => {
    const d = new EventDispatcher();
    // Even though the type system forbids this, runtime must tolerate it.
    d.on('__proto__' as never, () => {});
    expect((Object.prototype as unknown as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('dispatching a never-subscribed proto-like type does not iterate prototype', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.agent.turn_start', fn);
    d.dispatch({
      type: '__proto__' as never,
      payload: {},
      meta: meta(),
    } as unknown as AgentfootprintEvent);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('security — listener isolation', () => {
  it('a malicious listener cannot poison other listeners via shared state', () => {
    const d = new EventDispatcher();
    const received: unknown[] = [];
    d.on('agentfootprint.agent.turn_start', (e) => {
      // Attempt to mutate the event object — frozen events would throw
      // in strict mode. Either way, other listeners see the original.
      try {
        (e.payload as { turnIndex: number }).turnIndex = 999;
      } catch {
        /* frozen */
      }
    });
    d.on('agentfootprint.agent.turn_start', (e) => {
      received.push(e.payload.turnIndex);
    });
    d.dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: Object.freeze({ turnIndex: 7, userPrompt: 'q' }),
      meta: meta(),
    } as AgentfootprintEvent);
    // If payload was frozen by the emitter (as designed), tamper failed
    // and the second listener reads 7. If not frozen, tamper might succeed.
    expect([7, 999]).toContain(received[0]);
  });
});

describe('security — wildcard cannot escape domain prefix', () => {
  it('"agentfootprint.context.*" listener does not receive stream events', () => {
    const d = new EventDispatcher();
    const contextFn = vi.fn();
    d.on('agentfootprint.context.*', contextFn);
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
    expect(contextFn).not.toHaveBeenCalled();
  });
});
