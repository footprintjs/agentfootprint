/**
 * THE CUT — hand-made recordings for the shapes a real run rarely produces:
 * no subflows, one oversized result, proven and unproven aliases, a mount with
 * no result, a result no mount reaches, nesting, and the bounds.
 */
import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import {
  openSavedRecording,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import { splitRecording } from '../../../../src/recorders/observability/recordingParts/split.js';
import { RecordingSplitError } from '../../../../src/recorders/observability/recordingParts/splitError.js';
import { SCOPE, fileParts } from './helpers.js';

type Rec = Record<string, unknown>;

function unit(subflowId: string, stageContexts: Rec = {}, weight = 0): Rec {
  return {
    subflowId,
    subflowName: subflowId,
    parentStageId: 'seed',
    treeContext: { globalContext: { pad: 'x'.repeat(weight) }, stageContexts, history: [] },
  };
}

function mount(key: string, subflowId: string, next?: Rec): Rec {
  return { id: subflowId, name: subflowId, subflowId, runtimeStageId: key, ...(next && { next }) };
}

function recordingOf(tree: Rec | null, results?: Rec): Recording {
  return {
    snapshot: {
      runId: 'snapshot-run',
      executionTree: tree,
      ...(results !== undefined && { subflowResults: results }),
    },
    events: [],
    structure: { id: 'seed', name: 'seed' },
  };
}

async function open(recording: Recording, targetBytes = 1024): Promise<SavedRecording> {
  const store = inMemoryArtifacts();
  const filed = await fileParts(store, recording, { targetBytes });
  const saved = await openSavedRecording(bindArtifacts(store, SCOPE), filed.index);
  if (saved.status !== 'ready') throw new Error(saved.reason);
  return saved;
}

const plain = (recording: Recording): unknown => JSON.parse(JSON.stringify(recording));

describe('the cut', () => {
  it('a run with no subflows is an index and a base part; nothing is added on the way back', async () => {
    const recording = recordingOf({ id: 'seed', name: 'seed' });
    const split = await splitRecording(recording);
    expect(split.parts).toEqual([]);
    expect(split.draft.hasSubflowResults).toBe(false);
    const saved = await open(recording);
    expect(saved.invocations).toEqual([]);
    expect(saved.sizes.artifacts).toBe(2);
    expect(await saved.readRoot()).toEqual({ status: 'ready', recording: plain(recording) });
    expect(await saved.readWhole()).toEqual({ status: 'ready', recording: plain(recording) });
  });

  it('the base part has no subflowResults key at all', async () => {
    const recording = recordingOf(mount('a#1', 'a'), { a: unit('a'), 'a#1': unit('a') });
    const split = await splitRecording(recording);
    const base = JSON.parse(split.base.text) as { recording: { snapshot: Rec } };
    expect(Object.keys(base.recording.snapshot)).toEqual(['runId', 'executionTree']);
  });

  it('results fill parts in order; one result larger than the target is a part of its own', async () => {
    const tree = mount('a#1', 'a', mount('b#2', 'b', mount('c#3', 'c', mount('d#4', 'd'))));
    const results = {
      'a#1': unit('a', {}, 100),
      'b#2': unit('b', {}, 100),
      'c#3': unit('c', {}, 5000),
      'd#4': unit('d', {}, 100),
    };
    const split = await splitRecording(recordingOf(tree, results), { targetBytes: 1024 });
    expect(split.draft.invocations.map((row) => row.part)).toEqual([0, 0, 1, 2]);
    expect(split.parts[1]!.bytes).toBeGreaterThan(5000);
    for (const part of [split.parts[0]!, split.parts[2]!]) expect(part.bytes).toBeLessThan(1200);
  });

  it('nested invocations carry their full path; the viewer order puts next before children', async () => {
    const inner = mount('a/x#3', 'a/x');
    const tree = {
      id: 'root',
      name: 'root',
      children: [mount('a#1', 'a')],
      next: mount('b#2', 'b'),
    };
    const results = {
      'a#1': unit('a', inner),
      'a/x#3': unit('a/x'),
      'b#2': unit('b'),
    };
    const saved = await open(recordingOf(tree, results));
    expect(saved.complete).toBe(true);
    expect(saved.invocations.map((row) => row.path)).toEqual([['b#2'], ['a#1'], ['a#1', 'a/x#3']]);
  });

  it('an alias equal byte for byte to a result is not stored; a different one is, and both come back', async () => {
    // JSON.parse makes `__proto__` an own key, as a stored recording would.
    const parsed = JSON.parse(
      '{"snapshot":{"runId":"snapshot-run","executionTree":' +
        JSON.stringify(mount('a#1', 'a')) +
        ',"subflowResults":{"a":' +
        JSON.stringify(unit('a')) +
        ',"a#1":' +
        JSON.stringify(unit('a')) +
        ',"old":{"kept":1},"__proto__":{"kept":2}}},"events":[],"structure":{}}',
    ) as Recording;
    const split = await splitRecording(parsed);
    expect(split.draft.aliases).toEqual([
      { name: 'a', key: 'a#1' },
      { name: 'old', part: 0 },
      { name: '__proto__', part: 0 },
    ]);
    const saved = await open(parsed);
    expect([...saved.aliases]).toEqual([['a', 'a#1']]);
    const whole = await saved.readWhole();
    expect(whole.status).toBe('ready');
    if (whole.status === 'ready') {
      const back = (whole.recording.snapshot as Rec).subflowResults as Rec;
      expect(Object.getOwnPropertyDescriptor(back, '__proto__')?.value).toEqual({ kept: 2 });
      expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
      expect(whole.recording).toEqual(parsed);
    }
    expect(await saved.readInvocation('a')).toEqual({
      status: 'unavailable',
      reason: 'not-recorded',
    });
  });

  it('a mount with no recorded result: complete is false, the invocation is listed and not-recorded', async () => {
    const recording = recordingOf(mount('a#1', 'a', mount('b#2', 'b')), { 'a#1': unit('a') });
    const saved = await open(recording);
    expect(saved.complete).toBe(false);
    expect(saved.invocations.map((row) => [row.key, row.recorded])).toEqual([
      ['a#1', true],
      ['b#2', false],
    ]);
    expect(await saved.readInvocation('b#2')).toEqual({
      status: 'unavailable',
      reason: 'not-recorded',
    });
    expect(await saved.readWhole()).toEqual({ status: 'ready', recording: plain(recording) });
  });

  it('a result no mount reaches: complete is false, it is stored and the whole reads back', async () => {
    const recording = recordingOf(mount('a#1', 'a'), { 'a#1': unit('a'), 'z#9': unit('z') });
    const saved = await open(recording);
    expect(saved.complete).toBe(false);
    expect(saved.invocations.map((row) => row.key)).toEqual(['a#1']);
    expect(await saved.readInvocation('z#9')).toEqual({
      status: 'unavailable',
      reason: 'not-recorded',
    });
    expect(await saved.readWhole()).toEqual({ status: 'ready', recording: plain(recording) });
  });

  it('a result in a shape the viewer refuses leaves complete false and is still stored', async () => {
    const recording = recordingOf(mount('a#1', 'a'), { 'a#1': { subflowId: 'other' } });
    const saved = await open(recording);
    expect(saved.complete).toBe(false);
    expect(await saved.readInvocation('a#1')).toEqual({
      status: 'ready',
      invocation: saved.invocations[0],
      result: { subflowId: 'other' },
    });
  });
});

describe('what the cut refuses', () => {
  it('more invocations than the viewer lists is over-limit, and names the bound', async () => {
    // A wide tree: the realistic way a run exceeds the count.
    const children: Rec[] = [];
    const results: Rec = {};
    for (let i = 1; i <= 4097; i++) {
      children.push(mount(`s${i}#${i}`, `s${i}`));
      results[`s${i}#${i}`] = unit(`s${i}`);
    }
    const refused = await splitRecording(
      recordingOf({ id: 'seed', name: 'seed', children }, results),
    ).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(RecordingSplitError);
    expect(refused).toMatchObject({ code: 'over-limit', limit: 'invocations' });
  });

  it('a chain too deep for any stack AND over the count is over-limit: the bounds are decided before serializing', async () => {
    // 60,000 levels of `next` overflow JSON's serializer on every runtime; 4,097 of them are mounts.
    let tree: Rec | undefined;
    const results: Rec = {};
    for (let i = 60_000; i >= 1; i--) {
      const isMount = i % 14 === 0 && Object.keys(results).length < 4097;
      if (isMount) {
        tree = mount(`s${i}#${i}`, `s${i}`, tree);
        results[`s${i}#${i}`] = unit(`s${i}`);
      } else tree = { id: `p${i}`, name: `p${i}`, ...(tree && { next: tree }) };
    }
    expect(Object.keys(results)).toHaveLength(4097);
    const refused = await splitRecording(recordingOf(tree!, results)).catch((err: unknown) => err);
    expect(refused).toMatchObject({ code: 'over-limit', limit: 'invocations' });
  });

  it('a chain too deep for any stack but within the bounds is unserializable', async () => {
    let tree: Rec | undefined;
    for (let i = 100_000; i >= 1; i--) {
      tree = { id: `p${i}`, name: `p${i}`, ...(tree && { next: tree }) };
    }
    await expect(splitRecording(recordingOf(tree!, {}))).rejects.toMatchObject({
      code: 'unserializable',
    });
  });

  it('a value that is not a recording, a non-object subflowResults, and a cycle are refused by code', async () => {
    await expect(splitRecording({ snapshot: {} })).rejects.toMatchObject({
      code: 'not-a-recording',
    });
    await expect(
      splitRecording({ snapshot: { subflowResults: [] }, events: [] }),
    ).rejects.toMatchObject({ code: 'not-a-recording' });
    const cyclic: Rec = { events: [] };
    cyclic.self = cyclic;
    await expect(splitRecording(cyclic)).rejects.toMatchObject({ code: 'unserializable' });
    await expect(splitRecording(recordingOf(null), { runId: '' })).rejects.toThrow(TypeError);
  });

  it('a refusal says which bound, never which key or value', async () => {
    const error = new RecordingSplitError('over-limit', 'path');
    expect(error.message).toBe(
      'The recording is larger than a saved recording in parts may be (limit: path).',
    );
  });
});

describe('the cut answers what the viewer would refuse', () => {
  it('an empty subflowResults key is a malformed recording, not a large one', async () => {
    const recording = recordingOf(mount('a#1', 'a'), { 'a#1': unit('a'), '': { odd: true } });
    await expect(splitRecording(recording)).rejects.toMatchObject({ code: 'not-a-recording' });
    const store = inMemoryArtifacts();
    const ref = (
      await store.put(SCOPE, {
        kind: 'recording/run',
        mediaType: 'application/json',
        data: JSON.stringify(recording),
      })
    ).meta.ref;
    expect(await openSavedRecording(bindArtifacts(store, SCOPE), ref)).toEqual({
      status: 'unavailable',
      reason: 'invalid-recording',
    });
  });

  it('a recording with no snapshot is not complete', async () => {
    const split = await splitRecording({ events: [], structure: {} });
    expect(split.draft.complete).toBe(false);
    expect(split.draft.invocations).toEqual([]);
  });

  it('a root drill path that takes a mount past 128 segments is not complete', async () => {
    const drilled = (depth: number): Recording => {
      const drillPath = Array.from({ length: depth }, (_, i) => `outer${i}#${i}`);
      const result = unit('a');
      (result.treeContext as Rec).logAddress = {
        logRunId: 'log',
        drillPath: [...drillPath, 'a#1'],
      };
      return {
        snapshot: {
          runId: 'snapshot-run',
          logAddress: { logRunId: 'log', drillPath },
          executionTree: mount('a#1', 'a'),
          subflowResults: { 'a#1': result },
        },
        events: [],
        structure: {},
      };
    };
    expect((await splitRecording(drilled(127))).draft.complete).toBe(true);
    expect((await splitRecording(drilled(128))).draft.complete).toBe(false);
    expect((await splitRecording(drilled(129))).draft.complete).toBe(false);
  });
});
