/**
 * eventTail — the ONE bounded ring buffer both event-tail consumers use.
 *
 * Two features hold a tail of the same stream (`recordRun` and
 * `SelfExplainBinding`). Written twice, they would eventually disagree
 * about what "dropped" means, and one of them would stop reporting it —
 * which is the failure mode that matters, because a tail that silently
 * starts mid-run reads as the whole run.
 *
 * Convention-3 tiers: unit (the buffer) · anti-drift (both consumers share
 * this implementation, asserted through their own public surfaces).
 */

import { describe, expect, it } from 'vitest';

import type { AgentfootprintEvent } from '../../src/events.js';
import { DEFAULT_MAX_EVENTS, eventTail } from '../../src/events/eventTail.js';

const event = (n: number): AgentfootprintEvent =>
  ({ type: 'agentfootprint.stream.token', payload: { n }, meta: {} } as never);

describe('eventTail — bounded', () => {
  it('keeps everything under the cap and drops nothing', () => {
    const tail = eventTail(5);
    for (let i = 0; i < 5; i++) tail.push(event(i));
    expect(tail.count).toBe(5);
    expect(tail.dropped).toBe(0);
  });

  it('drops the OLDEST past the cap — the end of a turn is what gets asked about', () => {
    const tail = eventTail(3);
    for (let i = 0; i < 7; i++) tail.push(event(i));
    expect(tail.count).toBe(3);
    expect(tail.dropped).toBe(4);
    const kept = tail.snapshot().events.map((e) => (e.payload as { n: number }).n);
    expect(kept).toEqual([4, 5, 6]);
  });

  it('falls back to the default rather than producing a tail that keeps nothing', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const tail = eventTail(bad);
      for (let i = 0; i < 3; i++) tail.push(event(i));
      expect(tail.count, `cap ${bad}`).toBe(3);
    }
    expect(DEFAULT_MAX_EVENTS).toBe(10_000);
  });
});

describe('eventTail — honest', () => {
  it('snapshot() is a COPY — a frozen read does not keep growing behind the caller', () => {
    const tail = eventTail(10);
    tail.push(event(1));
    const frozen = tail.snapshot();
    tail.push(event(2));
    expect(frozen.events).toHaveLength(1);
    expect(tail.count).toBe(2);
  });

  it('reports the drop count beside the events, never only the events', () => {
    const tail = eventTail(2);
    for (let i = 0; i < 5; i++) tail.push(event(i));
    const frozen = tail.snapshot();
    expect(frozen.events).toHaveLength(2);
    expect(frozen.dropped).toBe(3);
  });
});
