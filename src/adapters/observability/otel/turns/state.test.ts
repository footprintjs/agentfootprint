import { describe, expect, it } from 'vitest';
import { createTurnStore, type TurnState } from './state.js';
import { makeCapture } from '../../../../../test/helpers/otelCapture.js';

export function turn(): TurnState {
  return {
    stack: [],
    sampled: true,
    toolSpans: new Map(),
    toolNames: new Map(),
    standingEvents: 0,
    standingOmitted: 0,
    proposedArgs: new Map(),
  };
}

describe('OTel turn window', () => {
  it('keeps exactly 32 closed turns and remembers whether an evicted run had a span', () => {
    const store = createTurnStore();
    const capture = makeCapture();
    const t = turn();
    t.root = capture.tracer.startSpan('root');
    store.rememberClosed('sampled', t);
    store.rememberClosed('unsampled', { ...turn(), sampled: false });
    for (let i = 0; i < 32; i++) store.rememberClosed(String(i), turn());
    expect(store.closedTurns.size).toBe(32);
    expect(store.rootOf('sampled')).toBeUndefined();
    expect(store.forgottenRuns.get('sampled')).toBe(true);
    expect(store.forgottenRuns.get('unsampled')).toBe(false);
    expect(store.heldRun('31')?.runId).toBe('31');
    expect(store.heldRun('sampled')).toBeUndefined();
  });

  it('a flow decision has no implicit run when turns interleave', () => {
    const store = createTurnStore();
    const a = turn();
    store.activeTurns.set('a', a);
    expect(store.soleActiveTurn()).toBe(a);
    store.activeTurns.set('b', turn());
    expect(store.soleActiveTurn()).toBeUndefined();
    expect(store.heldRun('a')?.live).toBe(a);
    expect(store.heldRun('missing')).toBeUndefined();
  });
});
