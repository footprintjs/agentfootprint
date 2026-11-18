import { describe, expect, it } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import { EventDispatcher } from '../events/dispatcher.js';
import { typedEmit } from '../recorders/core/typedEmit.js';
import { conversationRedaction } from './conversation.js';
import { bindScopeComputation, createRunRedaction, emitServed } from './runRedaction.js';
import { SERVED_PLACEHOLDER } from './served.js';

function fixture(policy = false) {
  const order: string[] = [],
    computed: unknown[] = [],
    real: unknown[] = [],
    recorded: unknown[] = [];
  const dispatcher = new EventDispatcher();
  const stop = dispatcher.onRealEvent((event) => {
    order.push('real');
    real.push(event.payload);
  });
  const run = createRunRedaction({
    policy: policy ? conversationRedaction() : undefined,
    dispatcher,
    getRunContext: () => ({ runId: 'synthetic-serving' } as never),
  });
  const scope = {
    $emit(_name: string, payload?: unknown) {
      order.push('record');
      recorded.push(payload);
    },
  };
  run.bindScope(scope, {
    runtimeStageId: 'synthetic#1',
    getRedactionRule: () => new RedactionRule(run.recordPolicy),
  } as never);
  bindScopeComputation(scope, {
    owner: {},
    retired: () => false,
    emit(_type, payload) {
      order.push('computation');
      computed.push(payload);
    },
  });
  return { scope, order, computed, real, recorded, stop };
}
const raw = () => ({
  turnIndex: 0,
  iterIndex: 1,
  toolCallCount: 0,
  history: [
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'call', name: 'lookup', args: { vm: 'private' } }],
    },
  ],
});

describe('one native raw-to-served event boundary', () => {
  it('keeps default three-argument identity and ordering exact', () => {
    const f = fixture();
    try {
      const payload = raw();
      typedEmit(f.scope, 'agentfootprint.agent.iteration_end', payload);
      expect(f.order).toEqual(['computation', 'real', 'record']);
      expect(f.computed[0]).toBe(payload);
      expect(f.real[0]).toBe(payload);
      expect(f.recorded[0]).toBe(payload);
    } finally {
      f.stop();
    }
  });

  it('offers an alternate shown record only after both private consumers receive the original object', () => {
    const f = fixture();
    try {
      const payload = raw();
      const view = {
        ...payload,
        history: [
          {
            ...payload.history[0]!,
            toolCalls: [{ id: 'call', name: 'lookup', args: { vm: 'REDACTED' } }],
          },
        ],
      };
      typedEmit(f.scope, 'agentfootprint.agent.iteration_end', payload, view);
      expect(f.order).toEqual(['computation', 'real', 'record']);
      expect(f.computed[0]).toBe(payload);
      expect(f.real[0]).toBe(payload);
      expect(f.recorded[0]).toBe(view);
      expect(payload.history[0]?.toolCalls[0]?.args.vm).toBe('private');
    } finally {
      f.stop();
    }
  });

  it('still applies the actual caller conversation policy after the shown record projection', () => {
    const f = fixture(true);
    try {
      const payload = raw(),
        view = { ...payload, history: [...payload.history] };
      typedEmit(f.scope, 'agentfootprint.agent.iteration_end', payload, view);
      expect(f.computed[0]).toBe(payload);
      expect(f.real[0]).toBe(payload);
      expect(JSON.stringify(f.recorded)).not.toContain('private');
      expect(f.recorded[0]).not.toBe(view);
    } finally {
      f.stop();
    }
  });

  it('keeps the unregistered fail-closed branch and retired computation guard unchanged', () => {
    const recorded: unknown[] = [],
      computed: unknown[] = [];
    const scope = {
      $emit(_name: string, payload?: unknown) {
        recorded.push(payload);
      },
    };
    bindScopeComputation(scope, {
      owner: {},
      retired: () => true,
      emit(_type, value) {
        computed.push(value);
      },
    });
    emitServed(scope, 'synthetic.event', raw(), { shouldNeverAppear: 'private' });
    expect(computed).toEqual([]);
    expect(recorded).toEqual([SERVED_PLACEHOLDER]);
  });
});
