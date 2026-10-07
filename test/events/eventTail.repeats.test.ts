/**
 * eventTail — a re-announced piece of context holds no slot.
 *
 * Every model call re-announces what is in its context
 * (`agentfootprint.context.injected` per piece per call), so a long run fired
 * events with the square of its iteration count, and a 100-iteration run's
 * recording opened at iteration ~33: the default cap evicted the start.
 *
 * Test types:
 *   - UNIT        — a repeat is kept (the stream stays whole) but takes no slot,
 *                   and shares the held payload; identity is decided on the
 *                   whole payload, never on the 32-bit `contentHash`; eviction
 *                   still leaves one contiguous suffix.
 *   - SCENARIO    — a real 100-iteration agent run under the default cap keeps
 *                   its first iteration.
 *   - WORK COUNT  — the slots a run holds grow with the iterations, not their
 *                   square.
 */
import { describe, expect, it } from 'vitest';

import type { AgentfootprintEvent } from '../../src/events.js';
import { eventTail } from '../../src/events/eventTail.js';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { recordRun } from '../../src/observe.js';

const INJECTED = 'agentfootprint.context.injected';

const announce = (content: string, contentHash = `h-${content}`, n = 0): AgentfootprintEvent =>
  ({
    type: INJECTED,
    payload: { slot: 'messages', contentHash, rawContent: content, position: 0 },
    meta: { n },
  } as never);

const other = (n: number): AgentfootprintEvent =>
  ({ type: 'agentfootprint.stream.token', payload: { n }, meta: { n } } as never);

describe('eventTail — repeats', () => {
  it('UNIT: a repeat is kept in order, holds no slot, and shares the held payload', () => {
    const tail = eventTail(3);
    tail.push(announce('a', undefined, 1));
    tail.push(other(2));
    tail.push(announce('a', undefined, 3)); // a repeat
    tail.push(announce('a', undefined, 4)); // another
    tail.push(other(5));
    const { events, dropped } = tail.snapshot();
    expect(dropped).toBe(0);
    expect(events.map((e) => (e.meta as { n: number }).n)).toEqual([1, 2, 3, 4, 5]);
    expect(events[2]!.payload).toBe(events[0]!.payload);
    expect(events[3]!.payload).toBe(events[0]!.payload);
  });

  it('UNIT: the same contentHash over different content is two pieces, never one', () => {
    const tail = eventTail(10);
    tail.push(announce('first', 'collide'));
    tail.push(announce('second', 'collide'));
    const { events } = tail.snapshot();
    expect(events[1]!.payload).not.toBe(events[0]!.payload);
    expect((events[1]!.payload as { rawContent: string }).rawContent).toBe('second');
    // Both hold a slot: a third distinct event under cap 2 evicts the oldest.
    const small = eventTail(2);
    small.push(announce('first', 'collide'));
    small.push(announce('second', 'collide'));
    small.push(other(1));
    expect(small.dropped).toBe(1);
  });

  it('UNIT: a payload that differs anywhere — a field, a key order — is not a repeat', () => {
    const tail = eventTail(10);
    const base = { slot: 'messages', contentHash: 'h', rawContent: 'x', position: 0 };
    tail.push({ type: INJECTED, payload: base, meta: {} } as never);
    tail.push({ type: INJECTED, payload: { ...base, position: 1 }, meta: {} } as never);
    const reordered = { contentHash: 'h', slot: 'messages', rawContent: 'x', position: 0 };
    tail.push({ type: INJECTED, payload: reordered, meta: {} } as never);
    const payloads = tail.snapshot().events.map((e) => e.payload);
    expect(new Set(payloads).size).toBe(3);
  });

  it('UNIT: eviction takes the oldest — repeats with it — and the window stays one suffix', () => {
    const tail = eventTail(2);
    tail.push(announce('a', undefined, 0)); // slot 1
    tail.push(announce('a', undefined, 1)); // repeat
    tail.push(other(2)); // slot 2
    tail.push(other(3)); // slot 3 → evicts #0 (and nothing else holds a slot before #2)
    const snap = tail.snapshot();
    expect(snap.dropped).toBe(1);
    expect(snap.firstRetainedIndex).toBe(1);
    expect(snap.events.map((e) => (e.meta as { n: number }).n)).toEqual([1, 2, 3]);
    tail.push(other(4)); // evicts the repeat #1, then #2
    const later = tail.snapshot();
    expect(later.dropped).toBe(3);
    expect(later.firstRetainedIndex).toBe(3);
    expect(later.events.map((e) => (e.meta as { n: number }).n)).toEqual([3, 4]);
  });

  it('UNIT: once the held announcement is evicted, the next one holds a slot again', () => {
    const tail = eventTail(1);
    tail.push(announce('a', undefined, 0));
    tail.push(other(1)); // evicts the held 'a'
    tail.push(announce('a', undefined, 2)); // no longer a repeat — holds the slot
    const snap = tail.snapshot();
    expect(snap.events.map((e) => (e.meta as { n: number }).n)).toEqual([2]);
    expect(snap.dropped).toBe(2);
  });

  it('UNIT: count, dropped and the window agree across the bulk compaction', () => {
    const tail = eventTail(100);
    for (let i = 0; i < 5_000; i++) tail.push(other(i));
    const snap = tail.snapshot();
    expect(snap.events.length).toBe(100);
    expect(tail.count).toBe(100);
    expect(snap.dropped).toBe(4_900);
    expect((snap.events[0]!.meta as { n: number }).n).toBe(4_900);
  });
});

const rowsTool = defineTool<{ k: number }, unknown>({
  name: 'rows',
  description: 'returns rows',
  inputSchema: { type: 'object', properties: { k: { type: 'number' } } },
  execute: (args) => [{ k: args.k, name: `row-${args.k}` }],
});

async function record(iterations: number) {
  const replies = [
    ...Array.from({ length: iterations }, (_, i) => ({
      toolCalls: [{ id: `c${i + 1}`, name: 'rows', args: { k: i + 1 } }],
    })),
    { content: 'done' },
  ];
  const agent = Agent.create({
    provider: mock({ replies }),
    model: 'm',
    maxIterations: iterations + 5,
  })
    .tools([rowsTool])
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'go' });
  recorder.stop();
  const { events } = recorder.toRecording() as { events: readonly AgentfootprintEvent[] };
  // A repeat shares the payload object of the announcement that holds its slot.
  const payloads = new Set<unknown>();
  let repeats = 0;
  for (const e of events) {
    if (e.type === INJECTED && payloads.has(e.payload)) repeats += 1;
    payloads.add(e.payload);
  }
  return { recorder, events, held: events.length - repeats };
}

describe('a long run keeps its start', () => {
  it('SCENARIO: 100 iterations under the default cap — iteration 1 is in the recording', async () => {
    const { recorder, events } = await record(100);
    expect(recorder.droppedEvents).toBe(0);
    const first = events.find((e) => e.type === 'agentfootprint.stream.llm_start') as
      | { payload: { iteration: number } }
      | undefined;
    expect(first?.payload.iteration).toBe(1);
    // It fired past the cap: without the rule, the start would be gone.
    expect(events.length).toBeGreaterThan(10_000);
  }, 60_000);

  it('WORK COUNT: the slots held grow with the iterations, not their square', async () => {
    const small = await record(10);
    const large = await record(40);
    expect(large.held / small.held).toBeLessThan(5);
    // The stream itself still grows faster — every call re-announces.
    expect(large.events.length / small.events.length).toBeGreaterThan(large.held / small.held);
  }, 60_000);
});
