/**
 * H8 · A FORGED INDEX — every malformed index is refused whole, before any
 * part is read: by the admission check itself, and through the reader as
 * `invalid-index`.
 */
import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { RECORDING_INDEX_ARTIFACT_KIND } from '../../../../src/artifacts/recordingArtifact.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import { openSavedRecording } from '../../../../src/observe.js';
import { readRecordingIndex } from '../../../../src/recorders/observability/recordingParts/format.js';
import { RUN_ID, SCOPE, counted, fileParts, realRecording } from './helpers.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const store = inMemoryArtifacts();
const filed = await fileParts(store, await realRecording(), { targetBytes: 16 * 1024 });
const valid = (): Json => JSON.parse(filed.indexText) as Json;

const forgeries: readonly [string, (index: Json) => void][] = [
  ['an unknown format', (i) => (i.format = 'agentfootprint.recording.index.v2')],
  ['an extra field', (i) => (i.extra = true)],
  ['a missing field', (i) => delete i.unmounted],
  ['a ref outside the grammar', (i) => (i.parts[0].ref = 'art_short')],
  ['a digest in another spelling', (i) => (i.parts[0].digest = `sha256:${'a'.repeat(64)}`)],
  ['a negative byte count', (i) => (i.base.bytes = -1)],
  ['the same ref twice', (i) => (i.parts[1].ref = i.parts[0].ref)],
  ['a part ordinal out of range', (i) => (i.invocations[0].part = i.parts.length)],
  ['a duplicate invocation key', (i) => i.invocations.push({ ...i.invocations[0] })],
  ['a key that is not an execution key', (i) => (i.invocations[0].key = 'sf-llm-call')],
  ['a path that does not end at its key', (i) => (i.invocations[0].path = ['other#1'])],
  [
    'a nested path whose parent is not listed',
    (i) => {
      const parentKey = i.invocations.find((row: Json) => row.path.length > 1).path[0];
      const parent = i.invocations.find((row: Json) => row.key === parentKey);
      i.invocations = i.invocations.filter((row: Json) => row !== parent);
      i.aliases = i.aliases.filter((alias: Json) => alias.key !== parentKey);
      i.parts[parent.part].results -= 1;
    },
  ],
  ['an alias to a key that is not stored', (i) => (i.aliases[0].key = 'missing#1')],
  ['an alias named like an invocation', (i) => (i.aliases[0].name = i.invocations[0].key)],
  ['a part holding a different count', (i) => (i.parts[0].results += 1)],
  ['bytes on an invocation with no part', (i) => (i.invocations[0].part = null)],
  [
    'complete while a result is unmounted',
    (i) => {
      i.unmounted.push({ key: 'zz#99', part: 0 });
      i.parts[0].results += 1;
    },
  ],
  ['a run id that is not a name', (i) => (i.runId = '')],
];

describe('H8 · a forged index is refused whole', () => {
  it('the unforged index is admitted, and opens when stored the way the forgeries are', async () => {
    expect(readRecordingIndex(valid())).toBeDefined();
    const ref = (
      await store.put(SCOPE, {
        kind: RECORDING_INDEX_ARTIFACT_KIND,
        mediaType: 'application/json',
        data: JSON.stringify(valid()),
        origin: { runId: RUN_ID },
      })
    ).meta.ref;
    expect((await openSavedRecording(bindArtifacts(store, SCOPE), ref)).status).toBe('ready');
  });

  it.each(forgeries)('refuses %s', async (_name, forge) => {
    const index = valid();
    forge(index);
    expect(readRecordingIndex(index)).toBeUndefined();

    const text = JSON.stringify(index);
    const ref = (
      await store.put(SCOPE, {
        kind: RECORDING_INDEX_ARTIFACT_KIND,
        mediaType: 'application/json',
        data: text,
        origin: { runId: RUN_ID },
      })
    ).meta.ref;
    const view = counted(store);
    expect(await openSavedRecording(view.artifacts, ref)).toEqual({
      status: 'unavailable',
      reason: 'invalid-index',
    });
    // Only the index was read.
    expect(view.calls.get).toEqual([ref]);
  });

  it('refuses an accessor property and a class instance, and never runs the getter', () => {
    let ran = false;
    const index = valid();
    Object.defineProperty(index, 'complete', {
      enumerable: true,
      get() {
        ran = true;
        return true;
      },
    });
    expect(readRecordingIndex(index)).toBeUndefined();
    expect(ran).toBe(false);
    class Shaped {}
    expect(readRecordingIndex(Object.assign(new Shaped(), valid()))).toBeUndefined();
  });

  it('refuses an index whose ticket names another run, and text that is not JSON', async () => {
    const other = (
      await store.put(SCOPE, {
        kind: RECORDING_INDEX_ARTIFACT_KIND,
        mediaType: 'application/json',
        data: filed.indexText,
        origin: { runId: 'another-run' },
      })
    ).meta.ref;
    const broken = (
      await store.put(SCOPE, {
        kind: RECORDING_INDEX_ARTIFACT_KIND,
        mediaType: 'application/json',
        data: '{"format":',
      })
    ).meta.ref;
    const artifacts = bindArtifacts(store, SCOPE);
    for (const ref of [other, broken]) {
      expect(await openSavedRecording(artifacts, ref)).toEqual({
        status: 'unavailable',
        reason: 'invalid-index',
      });
    }
  });
});
