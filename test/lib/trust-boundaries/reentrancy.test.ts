import { describe, expect, it } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { trustBoundaryRecorder } from '../../../src/lib/trust-boundaries/index.js';

function event(target: string) {
  return {
    type: 'agentfootprint.permission.check',
    meta: { runId: 'run', runtimeStageId: 'stage#1', wallClockMs: 1 },
    payload: { capability: 'tool_call', result: 'allow', target },
  };
}

function inspectOnce<T extends object>(value: T, during: () => void): T {
  let once = false;
  return new Proxy(value, {
    getOwnPropertyDescriptor(target, key) {
      if (!once) {
        once = true;
        during();
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

describe('trust capture reentrant transaction ownership', () => {
  it.each([1, 2, 3])(
    'keeps unique ordered newest facts under nested completion, maxFacts=%s',
    (maxFacts) => {
      const source = new EventDispatcher();
      const recorder = trustBoundaryRecorder({ maxFacts });
      recorder.subscribe(source);
      const outer = event('outer');
      outer.payload = inspectOnce(outer.payload, () => {
        const middle = event('middle');
        middle.payload = inspectOnce(middle.payload, () =>
          source.dispatch(event('inner') as AgentfootprintEvent),
        );
        source.dispatch(middle as AgentfootprintEvent);
      });
      source.dispatch(outer as AgentfootprintEvent);
      const snapshot = recorder.toSnapshot();
      expect(snapshot.data.facts.map((row) => row.seq)).toEqual([1, 2, 3].slice(-maxFacts));
      expect(snapshot.data.facts.map((row) => ('target' in row ? row.target : undefined))).toEqual(
        ['outer', 'middle', 'inner'].slice(-maxFacts),
      );
      expect(snapshot.data.counters).toEqual({
        observed: 3,
        retained: maxFacts,
        evicted: 3 - maxFacts,
        invalid: 0,
        oversized: 0,
        pending: 0,
      });
    },
  );

  it('reports a pending selected observation truthfully during its own projection', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder();
    recorder.subscribe(source);
    const outer = event('outer');
    outer.payload = inspectOnce(outer.payload, () => {
      expect(recorder.counters).toEqual({
        observed: 1,
        retained: 0,
        evicted: 0,
        invalid: 0,
        oversized: 0,
        pending: 1,
      });
      source.dispatch(event('inner') as AgentfootprintEvent);
      expect(recorder.counters).toEqual({
        observed: 2,
        retained: 1,
        evicted: 0,
        invalid: 0,
        oversized: 0,
        pending: 1,
      });
      expect(recorder.toSnapshot().data).toMatchObject({
        firstObservedSeq: 1,
        lastObservedSeq: 2,
        firstRetainedSeq: 2,
        lastRetainedSeq: 2,
      });
    });
    source.dispatch(outer as AgentfootprintEvent);
    expect(recorder.counters.pending).toBe(0);
    expect(recorder.toSnapshot().data.facts.map((row) => row.seq)).toEqual([1, 2]);
  });

  it.each(['payload', 'type classification'] as const)(
    'reset during %s cannot commit an old observation into the new epoch',
    (phase) => {
      const source = new EventDispatcher();
      const recorder = trustBoundaryRecorder();
      recorder.subscribe(source);
      const reset = () => {
        recorder.resetCapture();
        source.dispatch(event('new-window') as AgentfootprintEvent);
      };
      let outer = event('old-window');
      if (phase === 'payload') outer.payload = inspectOnce(outer.payload, reset);
      else outer = inspectOnce(outer, reset);
      const captureId = recorder.toSnapshot().data.captureId;
      source.dispatch(outer as AgentfootprintEvent);
      expect(recorder.toSnapshot().data.captureId).not.toBe(captureId);
      expect(recorder.toSnapshot().data.facts).toMatchObject([{ seq: 1, target: 'new-window' }]);
      expect(recorder.counters).toEqual({
        observed: 1,
        retained: 1,
        evicted: 0,
        invalid: 0,
        oversized: 0,
        pending: 0,
      });
    },
  );

  it('settles rejected outer metadata without hiding the inner fact or sequence gap', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder();
    recorder.subscribe(source);
    const outer = event('bad');
    outer.payload.result = 'invented';
    outer.payload = inspectOnce(outer.payload, () =>
      source.dispatch(event('inner') as AgentfootprintEvent),
    );
    source.dispatch(outer as AgentfootprintEvent);
    expect(recorder.toSnapshot().data.facts.map((row) => row.seq)).toEqual([2]);
    expect(recorder.counters).toEqual({
      observed: 2,
      retained: 1,
      evicted: 0,
      invalid: 1,
      oversized: 0,
      pending: 0,
    });
  });
});
