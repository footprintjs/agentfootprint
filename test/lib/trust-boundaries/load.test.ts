import { describe, expect, it } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { trustBoundaryRecorder } from '../../../src/lib/trust-boundaries/index.js';

describe('bounded trust capture lifecycle', () => {
  it.each([0, -1, 0.5, NaN, Infinity, 10001])('rejects invalid capacity %s', (maxFacts) => {
    expect(() => trustBoundaryRecorder({ maxFacts })).toThrow(/maxFacts/);
  });

  it('keeps exactly the requested tail through 25,000 inputs', () => {
    const source = new EventDispatcher();
    const recorder = trustBoundaryRecorder({ maxFacts: 37 });
    recorder.subscribe(source);
    for (let i = 0; i < 25000; i++)
      source.dispatch({
        type: 'agentfootprint.credential.requested',
        payload: { service: `service-${i}` },
        meta: { runId: `run-${i % 3}`, runtimeStageId: 'tool#1', wallClockMs: i },
      } as AgentfootprintEvent);
    const snapshot = recorder.toSnapshot();
    expect(snapshot.data.facts).toHaveLength(37);
    expect(snapshot.data.firstRetainedSeq).toBe(24964);
    expect(snapshot.data.lastRetainedSeq).toBe(25000);
    expect(snapshot.data.counters).toEqual({
      observed: 25000,
      retained: 37,
      evicted: 24963,
      invalid: 0,
      oversized: 0,
      pending: 0,
    });
    expect(snapshot.data.facts[0]).toHaveProperty('service', 'service-24963');
    recorder.resetCapture();
    expect(snapshot.data.facts).toHaveLength(37);
    expect(recorder.toSnapshot().data.firstRetainedSeq).toBeNull();
    expect(recorder.toSnapshot().data.lastObservedSeq).toBeNull();
  });

  it('recovers the subscription slot after registration throws', () => {
    const recorder = trustBoundaryRecorder();
    expect(() =>
      recorder.subscribe({
        on: () => {
          throw new Error('subscribe failed');
        },
      }),
    ).toThrow('subscribe failed');
    expect(() => recorder.subscribe(new EventDispatcher())).not.toThrow();
  });

  it('clears the active slot even when source teardown throws, and does not retry teardown', () => {
    let stops = 0;
    const recorder = trustBoundaryRecorder();
    const off = recorder.subscribe({
      on: () => () => {
        stops++;
        throw new Error('stop failed');
      },
    });
    expect(off).toThrow('stop failed');
    expect(off).not.toThrow();
    expect(stops).toBe(1);
    expect(() => recorder.subscribe(new EventDispatcher())).not.toThrow();
  });
});
