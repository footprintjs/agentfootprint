/**
 * The tail says WHERE its kept window starts, not only how much is gone
 * (9.60.0 — Context Integrity phase 0).
 *
 * A drop count alone cannot align a capped tail against another record of
 * the same run: "312 dropped" says how much, never which range. Under
 * oldest-first eviction the offset is derivable — the first retained
 * event's original position IS the drop count — and this suite pins that
 * equivalence as a stated field, so a reader gets
 * `[firstRetainedIndex, firstRetainedIndex + events.length)` without
 * re-deriving eviction policy.
 *
 * Test types (Convention 3): unit (the tail's range arithmetic) / contract
 * (envelope threading: proven from a live handle, honestly ABSENT on a bare
 * Recording, refused on a bad statement — never fabricated).
 */

import { describe, expect, it } from 'vitest';
import { eventTail } from '../../src/events/eventTail.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

const ev = (i: number): AgentfootprintEvent =>
  ({
    name: 'agentfootprint.stream.token',
    payload: { index: i },
    meta: { runId: 'r', runtimeStageId: `s#${i}`, timestamp: i },
  } as unknown as AgentfootprintEvent);

describe('unit: the retained window is a stated range', () => {
  it('starts at 0 while nothing has dropped', () => {
    const tail = eventTail(5);
    tail.push(ev(0));
    tail.push(ev(1));
    expect(tail.firstRetainedIndex).toBe(0);
    const snap = tail.snapshot();
    expect(snap.firstRetainedIndex).toBe(0);
    expect(snap.dropped).toBe(0);
  });

  it('events[i] is stream event firstRetainedIndex + i, across eviction', () => {
    const tail = eventTail(3);
    for (let i = 0; i < 10; i++) tail.push(ev(i));
    const snap = tail.snapshot();
    expect(snap.dropped).toBe(7);
    expect(snap.firstRetainedIndex).toBe(7);
    // The range claim, verified against the payloads themselves.
    snap.events.forEach((e, i) => {
      expect((e.payload as { index: number }).index).toBe(snap.firstRetainedIndex + i);
    });
    expect(snap.firstRetainedIndex + snap.events.length).toBe(10);
  });
});
