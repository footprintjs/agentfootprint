/**
 * The account stays within its bound on ANY record (README law 8: the account
 * ≤ 128 KB, the op's response ≤ 192 KB, by construction) — not only on the
 * records this library writes.
 *
 * A pointer copies identity from the record it points into: an event's
 * `runtimeStageId`, a history message's `toolCallId`. Those are the
 * library's and the provider's strings, short in every record this library
 * writes; a saved record can hold anything. One long id, repeated on every
 * pointer into that event, multiplied a recording of a few kilobytes into an
 * account of megabytes. And the standing fact listed one pointer per witness
 * row the fold read, with no cap. Both are bounded where they are made: an
 * identity is cut at 200 serialized bytes (law 8), and a fact's pointer list at `MAX_CALLS` (the
 * `limitsData` precedent).
 *
 * Found by a single-point damage sweep over every payload, meta and state leaf
 * of the recordings the account's own tests read (test/answer-account/
 * damaged-records.test.ts keeps a bounded copy of that sweep).
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { Agent, absent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun } from '../../src/observe.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { MAX_CALLS } from '../../src/answer-account/facts/calls.js';
import { POINTER_ID_BYTES } from '../../src/answer-account/size.js';
import type { RecordPointer } from '../../src/answer-account/types.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';
import { fixtureA, utf8Bytes } from './helpers.js';

const LONG = 'y'.repeat(50_000);

type Doc = {
  events: Array<{ type: string; payload: Record<string, unknown>; meta: Record<string, unknown> }>;
  snapshot: { sharedState: Record<string, unknown> };
};

const copyOf = (recording: Recording) => JSON.parse(JSON.stringify(recording)) as Doc;

/** Every pointer the account carries — on every sentence and every fact. */
function pointersOf(value: unknown, out: RecordPointer[] = []): RecordPointer[] {
  if (Array.isArray(value)) for (const item of value) pointersOf(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'pointers' && Array.isArray(child)) out.push(...(child as RecordPointer[]));
      else pointersOf(child, out);
    }
  }
  return out;
}

function expectWithinBound(recording: Recording): ReturnType<typeof accountForAnswer> {
  const account = accountForAnswer(recording);
  const shown = showLeaves(account, recording);
  expect(utf8Bytes(account)).toBeLessThanOrEqual(128 * 1024);
  expect(utf8Bytes({ account, shown })).toBeLessThanOrEqual(192 * 1024);
  return account;
}

async function declaringRecording(): Promise<Recording> {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'find_vm', args: {} }] },
        { content: 'No VMs on host-9.' },
      ] as never,
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'find_vm',
        description: 'the find_vm tool',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          absent({
            what: 'VMs on host-9',
            checked: ['the VM inventory'],
            notChecked: ['powered-off VMs'],
          }),
      }),
    )
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'what runs on host-9?' });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return recording;
}

describe('the account bound on a damaged record', () => {
  let declaring: Recording;
  beforeAll(async () => {
    declaring = await declaringRecording();
  });

  it.each(['y', '\u0001', '\uffff', '\ud800'])(
    'a long runtimeStageId (%s) is cut in every pointer by serialized bytes',
    (unit) => {
      const doc = copyOf(fixtureA());
      const end = doc.events.find((e) => e.type === 'agentfootprint.stream.tool_end')!;
      end.meta.runtimeStageId = unit.repeat(50_000);
      const account = expectWithinBound(doc as unknown as Recording);
      const ids = pointersOf(account).flatMap((p) =>
        p.kind === 'event' && p.runtimeStageId !== undefined ? [p.runtimeStageId] : [],
      );
      expect(ids.length).toBeGreaterThan(0);
      expect(
        Math.max(...ids.map((id) => Buffer.byteLength(JSON.stringify(id), 'utf8') - 2)),
      ).toBeLessThanOrEqual(POINTER_ID_BYTES);
    },
  );

  it('a 50,000-character toolCallId on a history message: cut in every pointer', () => {
    const doc = copyOf(declaring);
    const history = doc.snapshot.sharedState.history as Array<Record<string, unknown>>;
    const tool = history.find((m) => m.role === 'tool')!;
    tool.toolCallId = LONG;
    const account = expectWithinBound(doc as unknown as Recording);
    const ids = pointersOf(account).flatMap((p) =>
      p.kind === 'history' && p.toolCallId !== undefined ? [p.toolCallId] : [],
    );
    expect(
      Math.max(0, ...ids.map((id) => Buffer.byteLength(JSON.stringify(id), 'utf8') - 2)),
    ).toBeLessThanOrEqual(POINTER_ID_BYTES);
  });

  it('2,000 coverage rows: the standing fact lists at most MAX_CALLS pointers, and every reason is still counted', () => {
    const control = accountForAnswer(declaring);
    const doc = copyOf(declaring);
    const rows = doc.snapshot.sharedState.coverageDeclared as unknown[];
    expect(rows.length).toBeGreaterThan(0);
    doc.snapshot.sharedState.coverageDeclared = Array.from({ length: 2000 }, () => rows[0]);
    const account = expectWithinBound(doc as unknown as Recording);
    expect(account.facts.standing.pointers.length).toBeLessThanOrEqual(MAX_CALLS);
    expect(account.facts.standing.value).toBe(control.facts.standing.value);
  });
});
