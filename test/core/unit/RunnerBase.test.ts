/**
 * Unit tests — RunnerBase (the shared Runner implementation).
 */

import { describe, it, expect, vi } from 'vitest';
import type { CombinedRecorder, FlowChart, RunOptions } from 'footprintjs';
import { RunnerBase, makeRunId } from '../../../src/core/RunnerBase.js';
import type { AgentfootprintEventMap } from '../../../src/events/registry.js';

class TestRunner extends RunnerBase<string, string> {
  toFlowChart(): FlowChart {
    return {} as FlowChart; // stub — unused in these tests
  }
  async run(input: string, _options?: RunOptions): Promise<string> {
    return input;
  }
  /** Expose the internal dispatcher for tests only. */
  getInternalDispatcher() {
    return this.getDispatcher();
  }
  /** Expose attachedRecorders for tests only. */
  getAttachedRecorders(): readonly CombinedRecorder[] {
    return this.attachedRecorders;
  }
}

describe('RunnerBase — .on/.off/.once delegate to internal dispatcher', () => {
  it('.on receives events dispatched internally', () => {
    const r = new TestRunner();
    const fn = vi.fn();
    r.on('agentfootprint.agent.turn_start', fn);
    r.getInternalDispatcher().dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0, userPrompt: 'q' },
      meta: {
        wallClockMs: 0,
        runOffsetMs: 0,
        runtimeStageId: 's#0',
        subflowPath: [],
        compositionPath: [],
        runId: 'r',
      },
    } as AgentfootprintEventMap['agentfootprint.agent.turn_start']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('.off removes the listener', () => {
    const r = new TestRunner();
    const fn = vi.fn();
    r.on('agentfootprint.agent.turn_start', fn);
    r.off('agentfootprint.agent.turn_start', fn);
    r.getInternalDispatcher().dispatch({
      type: 'agentfootprint.agent.turn_start',
      payload: { turnIndex: 0, userPrompt: '' },
      meta: {
        wallClockMs: 0,
        runOffsetMs: 0,
        runtimeStageId: 's',
        subflowPath: [],
        compositionPath: [],
        runId: 'r',
      },
    } as AgentfootprintEventMap['agentfootprint.agent.turn_start']);
    expect(fn).not.toHaveBeenCalled();
  });

  it('.once fires only once', () => {
    const r = new TestRunner();
    const fn = vi.fn();
    r.once('agentfootprint.agent.turn_start', fn);
    const event = {
      type: 'agentfootprint.agent.turn_start' as const,
      payload: { turnIndex: 0, userPrompt: '' },
      meta: {
        wallClockMs: 0,
        runOffsetMs: 0,
        runtimeStageId: 's',
        subflowPath: [],
        compositionPath: [],
        runId: 'r',
      },
    };
    r.getInternalDispatcher().dispatch(event);
    r.getInternalDispatcher().dispatch(event);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('RunnerBase — .attach collects recorders', () => {
  it('adds each attached recorder to the internal list', () => {
    const r = new TestRunner();
    const rec: CombinedRecorder = { id: 'a', onEmit: () => {} };
    r.attach(rec);
    expect(r.getAttachedRecorders()).toContain(rec);
  });
});

describe('RunnerBase — .emit for consumer custom events', () => {
  it('dispatches custom event when a wildcard listener is attached', () => {
    const r = new TestRunner();
    const fn = vi.fn();
    r.on('*', fn);
    r.emit('myapp.billing.checkpoint', { userId: 'u1', spend: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].type).toBe('myapp.billing.checkpoint');
    expect(fn.mock.calls[0][0].payload).toEqual({ userId: 'u1', spend: 42 });
  });

  it('skip dispatch when no listener (fast path)', () => {
    const r = new TestRunner();
    const spy = vi.spyOn(r.getInternalDispatcher(), 'dispatch');
    r.emit('myapp.nobody.listens', { x: 1 });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('makeRunId', () => {
  it('produces distinct ids across calls', () => {
    const a = makeRunId();
    const b = makeRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^run-\d+-\d+$/);
  });
});
