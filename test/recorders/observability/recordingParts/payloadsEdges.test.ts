/**
 * S1 · EDGES THE REVIEW FOUND — the recording's own data that looks like the
 * cut's marks, a forged value too deep to measure, and the rule's corners
 * (an event with no payload still counts for the id; a strict subset of the
 * index's moves; a stored payload's bytes in the part grouping; a mark beside
 * a payload in the step graph).
 */
import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import { utf8Length } from '../../../../src/lib/utf8.js';
import { toWireJson } from '../../../../src/lib/wireJson.js';
import {
  buildStepGraphFromEvents,
  openSavedRecording,
  type DomainEvent,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import {
  splitRecording,
  splitRecordingData,
} from '../../../../src/recorders/observability/recordingParts/split.js';
import { boundaryEvents, engineRecording } from './engineRuns.js';
import { RUN_ID, SCOPE, fileParts, forgePart } from './helpers.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const rowsOf = (recording: Recording): Json[] =>
  (recording.snapshot as { recorders: Json[] }).recorders;

async function readBack(recording: Recording): Promise<{ saved: SavedRecording; index: Json }> {
  const store = inMemoryArtifacts();
  const filed = await fileParts(store, recording);
  const saved = await openSavedRecording(bindArtifacts(store, SCOPE), filed.index);
  if (saved.status !== 'ready') throw new Error(saved.reason);
  return { saved, index: JSON.parse(filed.indexText) as Json };
}

describe('a row whose meta already holds `subflowPayloads` is the recording’s own data', () => {
  const cases: [string, (recording: Recording) => void, { same: number; notLast: number }][] = [
    [
      'a foreign recorder row with the fact’s own value',
      (r) =>
        rowsOf(r).push({
          id: 'app-1',
          name: 'AppRow',
          data: [],
          meta: { subflowPayloads: 'with-invocation' },
        }),
      { same: 2, notLast: 0 },
    ],
    [
      'a foreign recorder row with any value',
      (r) =>
        rowsOf(r).push({
          id: 'app-2',
          name: 'AppRow',
          data: [1],
          meta: { subflowPayloads: 'anything' },
        }),
      { same: 2, notLast: 0 },
    ],
    [
      'the BoundaryEvents row itself already holding the fact',
      (r) =>
        (rowsOf(r).find((row) => row.name === 'BoundaryEvents')!.meta.subflowPayloads =
          'with-invocation'),
      { same: 0, notLast: 2 },
    ],
    [
      'the BoundaryEvents row holding the fact AND events with the mark key',
      (r) => {
        const row = rowsOf(r).find((one) => one.name === 'BoundaryEvents')!;
        row.meta.subflowPayloads = 'with-invocation';
        (row.data as Json[]).push({
          type: 'subflow.entry',
          runtimeStageId: 'sf-z#9',
          subflowId: 'sf-z',
          payloadWith: 'invocation',
        });
      },
      { same: 0, notLast: 2 },
    ],
    [
      'a foreign row whose events hold the mark key',
      (r) =>
        rowsOf(r).push({
          id: 'app-3',
          name: 'AppRow',
          data: [{ type: 'subflow.entry', runtimeStageId: 'sf-a#1', payloadWith: 'invocation' }],
          meta: { subflowPayloads: 'with-invocation' },
        }),
      { same: 2, notLast: 0 },
    ],
  ];

  it.each(cases)(
    '%s: filed, read whole, equal to what was saved',
    async (_name, plant, expected) => {
      const recording = await engineRecording('plain');
      plant(recording);
      const { saved, index } = await readBack(recording);
      expect(index.subflowPayloads.same).toBe(expected.same);
      expect(index.subflowPayloads.kept.notLast).toBe(expected.notLast);
      // Only the rows the cut marked are listed for a reader to restore.
      const boundaryAt = rowsOf(recording).findIndex((row) => row.name === 'BoundaryEvents');
      expect(index.subflowPayloads.rows).toEqual(expected.same > 0 ? [boundaryAt] : []);
      const whole = await saved.readWhole();
      expect(whole.status).toBe('ready');
      if (whole.status !== 'ready') return;
      expect(whole.recording).toEqual(recording);
      expect(toWireJson(rowsOf(whole.recording))).toBe(toWireJson(rowsOf(recording)));
    },
  );
});

describe('a forged `same` value deeper than this runtime can serialise answers a fixed reason', () => {
  it('readInvocation and readWhole answer too-large, never a raw RangeError', async () => {
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, await engineRecording('plain'));
    const part = JSON.parse(filed.split.parts[0]!.text) as Json;
    part.results['sf-a#1'].treeContext.globalContext = '__DEEP__';
    const depth = 20_000;
    const deep = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    const text = JSON.stringify(part).replace('"__DEEP__"', deep);
    const ref = await forgePart(store, filed, 0, text);
    const saved = await openSavedRecording(bindArtifacts(store, SCOPE), ref);
    if (saved.status !== 'ready') throw new Error(saved.reason);
    expect(await saved.readInvocation('sf-a#1')).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'too-large' });
  });
});

describe('a payload too deep for this runtime to write', () => {
  it('the writer refuses the recording as unserializable, never with a raw RangeError', async () => {
    const recording = JSON.parse(JSON.stringify(await engineRecording('plain'))) as Recording;
    const exit = boundaryEvents(recording).find((e) => e.type === 'subflow.exit')!;
    exit.payload = '__DEEP__';
    const depth = 20_000;
    const text = JSON.stringify(recording).replace(
      '"__DEEP__"',
      `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`,
    );
    await expect(splitRecordingData(JSON.parse(text) as unknown)).rejects.toMatchObject({
      name: 'RecordingSplitError',
      code: 'unserializable',
    });
  });
});

describe('the rule’s corners', () => {
  it('a second entry with NO payload still makes the id ambiguous (every event counts)', async () => {
    const recording = await engineRecording('plain');
    const events = boundaryEvents(recording);
    const { payload: _payload, ...bare } = events.find((e) => e.type === 'subflow.entry')!;
    void _payload;
    events.push(bare);
    const split = await splitRecording(recording, { runId: 'r' });
    expect(split.draft.subflowPayloads!.same + split.draft.subflowPayloads!.stored).toBe(0);
    expect(split.draft.subflowPayloads!.kept.ambiguous).toBe(2);
  });

  it('restored moves that are a strict SUBSET of the index’s places: part-changed', async () => {
    // A second sf-a#1 entry (no payload, no mark) in the stored base makes the
    // rule keep sf-a#1 once restored; the forged kept count matches the rerun,
    // so only the moved set (two fewer than placed) tells them apart.
    const store = inMemoryArtifacts();
    const filed = await fileParts(store, await engineRecording('loop'));
    const base = JSON.parse(filed.split.base.text) as { recording: Recording };
    const events = boundaryEvents(base.recording);
    const { payloadWith: _mark, ...secondEntry } = events.find(
      (e) => e.type === 'subflow.entry' && e.runtimeStageId === 'sf-a#1',
    )!;
    void _mark;
    events.push(secondEntry);
    // forgePart files the base and an index naming it; take that index and edit its counts.
    const withBase = await forgePart(store, filed, 'base', JSON.stringify(base));
    const forgedIndex = JSON.parse((await store.get(SCOPE, withBase))!.data as string) as Json;
    forgedIndex.subflowPayloads.kept.ambiguous = 2;
    const ref = (
      await store.put(SCOPE, {
        kind: 'recording/run-index',
        mediaType: 'application/json',
        data: JSON.stringify(forgedIndex),
        digest: 'sha-256',
        origin: { runId: RUN_ID },
      })
    ).meta.ref;
    const saved = await openSavedRecording(bindArtifacts(store, SCOPE), ref);
    if (saved.status !== 'ready') throw new Error(saved.reason);
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
  });

  it('a stored payload counts in the 1 MiB grouping: a result and its stored payloads are one unit', async () => {
    // Under a policy that selects the seeded `input`, every entry payload of the loop is stored.
    const recording = await engineRecording('loop', { policy: { keys: ['input'] } });
    const probe = await splitRecording(recording, { runId: 'r' });
    const [first, second] = probe.draft.invocations.filter((row) => row.part !== null);
    expect(first!.payloads?.entry).toBe('stored');
    expect(second!.payloads?.entry).toBe('stored');
    // A target the two RESULTS alone fit exactly: only their stored payloads' bytes split them.
    const resultsOnly = [first!, second!].reduce(
      (sum, row) => sum + utf8Length(toWireJson(row.key)) + (row.bytes as number) + 2,
      0,
    );
    const split = await splitRecording(recording, { runId: 'r', targetBytes: resultsOnly });
    const [a, b] = split.draft.invocations.filter((row) => row.part !== null);
    expect(a!.part).not.toBe(b!.part);
    const together = await splitRecording(recording, { runId: 'r', targetBytes: 1024 * 1024 });
    const [c, d] = together.draft.invocations.filter((row) => row.part !== null);
    expect(c!.part).toBe(d!.part);
  });

  it('the step graph keeps a payload that sits beside a mark, and draws no mark for it', () => {
    const base = {
      subflowPath: ['__root__', 'sf-a'],
      depth: 1,
      commitIdxBefore: 0,
      commitIdxAfter: 0,
      subflowId: 'sf-a',
      localSubflowId: 'sf-a',
      subflowName: 'A',
      isAgentInternal: false,
    };
    const graph = buildStepGraphFromEvents([
      {
        ...base,
        type: 'subflow.entry',
        runtimeStageId: 'sf-a#1',
        ts: 1,
        payload: { kept: true },
        payloadWith: 'invocation',
      },
      {
        ...base,
        type: 'subflow.exit',
        runtimeStageId: 'sf-a#1',
        ts: 2,
        payload: { out: 1 },
        payloadWith: 'invocation',
      },
    ] as unknown as DomainEvent[]);
    const node = graph.nodes.find((n) => n.id === 'sf-a#1')!;
    expect(node).toMatchObject({ entryPayload: { kept: true }, exitPayload: { out: 1 } });
    expect('entryPayloadWith' in node || 'exitPayloadWith' in node).toBe(false);
  });
});
