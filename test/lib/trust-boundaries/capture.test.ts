import { describe, expect, it } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import { trustBoundaryRecorder } from '../../../src/lib/trust-boundaries/index.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

function fact(type = 'agentfootprint.permission.check', payload: object = {}) {
  return {
    type,
    meta: { runId: 'agent-run', runtimeStageId: 'tool#1', wallClockMs: 25 },
    payload: { capability: 'tool_call', result: 'allow', ...payload },
  };
}

function send(source: EventDispatcher, event: unknown) {
  source.dispatch(event as AgentfootprintEvent);
}

describe('trust boundary capture', () => {
  it('captures a whitelisted fact, without asserting that an allowed operation executed', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder();
    recorder.subscribe(source);
    send(source, fact(undefined, { actor: 'excluded', reason: 'excluded', target: 'read' }));
    expect(recorder.toSnapshot()).toMatchObject({
      name: 'TrustBoundaries',
      meta: { version: 1 },
      data: {
        facts: [
          {
            seq: 1,
            eventType: 'agentfootprint.permission.check',
            runId: 'agent-run',
            runtimeStageId: 'tool#1',
            wallClockMs: 25,
            capability: 'tool_call',
            result: 'allow',
            target: 'read',
          },
        ],
        counters: { observed: 1, retained: 1, evicted: 0, invalid: 0, oversized: 0, pending: 0 },
      },
    });
    expect(JSON.stringify(recorder.toSnapshot())).not.toContain('excluded');
    expect(recorder.toSnapshot().data.facts[0]).not.toHaveProperty('executed');
  });

  it('keeps a bounded tail and explicit sequence gaps for rejected facts', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder({ maxFacts: 2 });
    recorder.subscribe(source);
    send(source, fact());
    send(source, fact(undefined, { result: 'invented' }));
    send(source, fact(undefined, { target: 'x'.repeat(513) }));
    send(source, fact());
    send(source, fact());
    expect(recorder.counters).toEqual({
      observed: 5,
      retained: 2,
      evicted: 1,
      invalid: 1,
      oversized: 1,
      pending: 0,
    });
    expect(recorder.toSnapshot().data.facts.map((row) => row.seq)).toEqual([4, 5]);
    expect(recorder.toSnapshot().data).toMatchObject({
      firstObservedSeq: 1,
      lastObservedSeq: 5,
      firstRetainedSeq: 4,
      lastRetainedSeq: 5,
    });
  });

  it('retains across run IDs and makes reset an explicit new capture window', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder();
    recorder.subscribe(source);
    const captureId = recorder.toSnapshot().data.captureId;
    send(source, fact());
    const next = fact();
    next.meta.runId = 'resumed-agent-run';
    send(source, next);
    expect(recorder.toSnapshot().data.facts).toHaveLength(2);
    expect(recorder.toSnapshot().data.captureId).toBe(captureId);
    recorder.resetCapture();
    expect(recorder.toSnapshot().data.captureId).not.toBe(captureId);
    expect(recorder.counters.observed).toBe(0);
    send(source, next);
    expect(recorder.toSnapshot().data.facts.map((row) => row.seq)).toEqual([1]);
  });

  it('rejects double subscription, and makes unsubscribe idempotent and re-subscription explicit', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder();
    const off = recorder.subscribe(source);
    expect(() => recorder.subscribe(source)).toThrow(/subscrib/i);
    off();
    off();
    send(source, fact());
    expect(recorder.counters.observed).toBe(0);
    recorder.subscribe(source);
    off();
    send(source, fact());
    expect(recorder.counters.observed).toBe(1);
  });

  it('returns frozen owned rows with independent snapshot arrays and counters', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder();
    recorder.subscribe(source);
    const event = fact(undefined, { target: 'before' });
    send(source, event);
    const first = recorder.toSnapshot();
    Object.assign(event.payload, { target: 'after' });
    send(source, fact());
    expect(first.data.facts).toHaveLength(1);
    expect(first.data.counters.observed).toBe(1);
    expect(first.data.facts[0]).toHaveProperty('target', 'before');
    expect(Object.isFrozen(first.data.facts[0])).toBe(true);
    expect(Object.isFrozen(first.data.facts)).toBe(true);
    expect(recorder.toSnapshot().data.facts).not.toBe(first.data.facts);
    expect(trustBoundaryRecorder().id).not.toBe(recorder.id);
    expect(recorder).not.toHaveProperty('onEmit');
  });
});
