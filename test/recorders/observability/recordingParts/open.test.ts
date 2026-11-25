/**
 * HONESTY — a missing, changed, oversized or foreign part is unavailable for
 * exactly the invocations it holds; the rest of the run still reads; every cap
 * is decided from metadata before any `get`; store failures are thrown, never
 * renamed. Every case counts the store calls it made.
 */
import { describe, expect, it } from 'vitest';

import { ArtifactIntegrityError, type ArtifactStore } from '../../../../src/artifacts/types.js';
import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { RECORDING_INDEX_ARTIFACT_KIND } from '../../../../src/artifacts/recordingArtifact.js';
import {
  openSavedRecording,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import { recordingIndexText } from '../../../../src/recorders/observability/recordingParts/split.js';
import {
  RUN_ID,
  SCOPE,
  STORES,
  counted,
  fileParts,
  fileWhole,
  forgePart,
  realRecording,
  type FiledParts,
} from './helpers.js';

const recording = await realRecording();
const other = await realRecording({ rows: 41 });

interface IndexRows {
  invocations: { key: string; part: number | null }[];
  aliases: { name: string; key?: string }[];
  parts: { ref: string }[];
}

function keysIn(filed: FiledParts, part: number): string[] {
  const rows = JSON.parse(filed.indexText) as IndexRows;
  return rows.invocations.filter((row) => row.part === part).map((row) => row.key);
}

async function opened(
  artifacts: Parameters<typeof openSavedRecording>[0],
  ref: string,
  options?: Parameters<typeof openSavedRecording>[2],
): Promise<SavedRecording> {
  const result = await openSavedRecording(artifacts, ref, options);
  if (result.status !== 'ready') throw new Error(`not opened: ${result.reason}`);
  return result;
}

/** Each invocation's read status, keyed. */
async function statuses(saved: SavedRecording): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const invocation of saved.invocations) {
    const read = await saved.readInvocation(invocation.key);
    out.set(invocation.key, read.status === 'ready' ? 'ready' : read.reason);
  }
  return out;
}

describe.each(STORES)('reading parts honestly — $name', (storeCase) => {
  async function setup(): Promise<{ filed: FiledParts; store: ArtifactStore; close(): void }> {
    const { store, close } = storeCase.create();
    const filed = await fileParts(store, recording, { targetBytes: 16 * 1024 });
    return { filed, store, close };
  }

  it('H1 · a removed part: exactly its invocations are part-missing; the rest and the root read', async () => {
    const { filed, store, close } = await setup();
    try {
      const target = 2;
      const held = keysIn(filed, target);
      expect(held.length).toBeGreaterThan(0);
      await store.delete(SCOPE, filed.parts[target]!);
      const saved = await opened(bindArtifacts(store, SCOPE), filed.index);
      for (const [key, status] of await statuses(saved)) {
        expect(status, key).toBe(held.includes(key) ? 'part-missing' : 'ready');
      }
      expect((await saved.readRoot()).status).toBe('ready');
      expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-missing' });
    } finally {
      close();
    }
  });

  it('H2 · a changed part (bytes or a store integrity refusal): exactly its invocations are part-changed', async () => {
    const { filed, store, close } = await setup();
    try {
      const target = 1;
      const held = keysIn(filed, target);
      const altered = counted(store, {
        data: (record) =>
          record.meta.ref === filed.parts[target]
            ? (record.data as string).replace('"subflowName":"', '"subflowName":"X')
            : record.data,
      });
      const saved = await opened(altered.artifacts, filed.index);
      for (const [key, status] of await statuses(saved)) {
        expect(status, key).toBe(held.includes(key) ? 'part-changed' : 'ready');
      }
      const integrity = counted(store, {
        fail: (ref, verb) =>
          verb === 'get' && ref === filed.parts[target]
            ? new ArtifactIntegrityError(ref, 'sha-256:a', 'sha-256:b')
            : undefined,
      });
      const again = await opened(integrity.artifacts, filed.index);
      expect(await again.readInvocation(held[0]!)).toEqual({
        status: 'unavailable',
        reason: 'part-changed',
      });
    } finally {
      close();
    }
  });

  it('H3 · caps are decided from metadata: an oversized part, index or whole is too-large with no get', async () => {
    const { filed, store, close } = await setup();
    try {
      const rows = JSON.parse(filed.indexText) as { parts: { bytes: number }[] };
      const biggest = Math.max(...rows.parts.map((part) => part.bytes));
      const big = rows.parts.findIndex((part) => part.bytes === biggest);
      const view = counted(store);
      const saved = await opened(view.artifacts, filed.index, { maxPartBytes: biggest - 1 });
      const getsBefore = view.calls.get.length;
      const headsBefore = view.calls.head.length;
      for (const key of keysIn(filed, big)) {
        expect(await saved.readInvocation(key)).toEqual({
          status: 'unavailable',
          reason: 'too-large',
        });
      }
      expect(view.calls.get.length).toBe(getsBefore);
      expect(view.calls.head.length).toBe(headsBefore);

      const index = counted(store);
      expect(await openSavedRecording(index.artifacts, filed.index, { maxIndexBytes: 10 })).toEqual(
        {
          status: 'unavailable',
          reason: 'too-large',
        },
      );
      expect(index.calls.get).toEqual([]);

      const wholeRef = await fileWhole(store, recording);
      const whole = counted(store);
      expect(await openSavedRecording(whole.artifacts, wholeRef, { maxRootBytes: 1000 })).toEqual({
        status: 'unavailable',
        reason: 'too-large',
      });
      expect(whole.calls.get).toEqual([]);

      // A ticket that disagrees with the index is changed, and is refused before its get.
      const lying = counted(store, {
        meta: (meta) => (meta.ref === filed.parts[0] ? { ...meta, bytes: meta.bytes + 1 } : meta),
      });
      const liar = await opened(lying.artifacts, filed.index);
      expect(await liar.readInvocation(keysIn(filed, 0)[0]!)).toEqual({
        status: 'unavailable',
        reason: 'part-changed',
      });
      expect(lying.calls.get).not.toContain(filed.parts[0]);
    } finally {
      close();
    }
  });

  it('H4 · a part swapped in from another run is part-changed, and no result from it is served', async () => {
    const { filed, store, close } = await setup();
    try {
      const foreign = await fileParts(store, other, { targetBytes: 16 * 1024 });
      const refs = { base: filed.base, parts: [...filed.parts] };
      refs.parts[0] = foreign.parts[0]!;
      const swapped = recordingIndexText(filed.split.draft, refs);
      const ref = (
        await store.put(SCOPE, {
          kind: RECORDING_INDEX_ARTIFACT_KIND,
          mediaType: 'application/json',
          data: swapped,
          origin: { runId: RUN_ID },
        })
      ).meta.ref;
      const saved = await opened(bindArtifacts(store, SCOPE), ref);
      const held = keysIn(filed, 0);
      for (const [key, status] of await statuses(saved)) {
        expect(status, key).toBe(held.includes(key) ? 'part-changed' : 'ready');
      }
    } finally {
      close();
    }
  });

  it('H5 · a missing base: the root is part-missing, invocations still read', async () => {
    const { filed, store, close } = await setup();
    try {
      await store.delete(SCOPE, filed.base);
      const saved = await opened(bindArtifacts(store, SCOPE), filed.index);
      expect(await saved.readRoot()).toEqual({ status: 'unavailable', reason: 'part-missing' });
      expect((await saved.readInvocation(saved.invocations[0]!.key)).status).toBe('ready');
    } finally {
      close();
    }
  });

  it('H6 · a key that is not a recorded invocation is not-recorded, with no store call', async () => {
    const { filed, store, close } = await setup();
    try {
      const view = counted(store);
      const saved = await opened(view.artifacts, filed.index);
      const before = view.calls.head.length + view.calls.get.length;
      const alias = [...saved.aliases.keys()][0]!;
      for (const key of [
        'sf-nowhere#999',
        alias,
        '__proto__',
        'x'.repeat(5000),
        42 as unknown as string,
        undefined as unknown as string,
      ]) {
        expect(await saved.readInvocation(key)).toEqual({
          status: 'unavailable',
          reason: 'not-recorded',
        });
      }
      expect(view.calls.head.length + view.calls.get.length).toBe(before);
    } finally {
      close();
    }
  });

  it('H7 · another scope: the index is not-found, and a part held in another scope is part-missing', async () => {
    const { filed, store, close } = await setup();
    try {
      const elsewhere = { conversationId: 'another-conversation' };
      expect(await openSavedRecording(bindArtifacts(store, elsewhere), filed.index)).toEqual({
        status: 'unavailable',
        reason: 'not-found',
      });
      // The same part bytes, stored in another scope, named by an index in this one.
      const outside = (
        await store.put(elsewhere, {
          kind: 'recording/run-part',
          mediaType: 'application/json',
          data: filed.split.parts[0]!.text,
          origin: { runId: RUN_ID },
        })
      ).meta.ref;
      const refs = { base: filed.base, parts: [...filed.parts] };
      refs.parts[0] = outside;
      const ref = (
        await store.put(SCOPE, {
          kind: RECORDING_INDEX_ARTIFACT_KIND,
          mediaType: 'application/json',
          data: recordingIndexText(filed.split.draft, refs),
          origin: { runId: RUN_ID },
        })
      ).meta.ref;
      const saved = await opened(bindArtifacts(store, SCOPE), ref);
      expect(await saved.readInvocation(keysIn(filed, 0)[0]!)).toEqual({
        status: 'unavailable',
        reason: 'part-missing',
      });
    } finally {
      close();
    }
  });

  it('H9 · cancellation: aborted before open makes no call; aborted after a head makes no get', async () => {
    const { filed, store, close } = await setup();
    try {
      const early = new AbortController();
      early.abort(new Error('stopped early'));
      const none = counted(store);
      await expect(
        openSavedRecording(none.artifacts, filed.index, { signal: early.signal }),
      ).rejects.toThrow('stopped early');
      expect(none.calls).toEqual({ head: [], get: [] });

      const late = new AbortController();
      const watched = counted(store, {
        fail: (ref, verb) => {
          if (verb === 'head' && ref === filed.parts[0]) late.abort(new Error('stopped late'));
          return undefined;
        },
      });
      const again = await opened(watched.artifacts, filed.index);
      await expect(
        again.readInvocation(keysIn(filed, 0)[0]!, { signal: late.signal }),
      ).rejects.toThrow('stopped late');
      expect(watched.calls.get).not.toContain(filed.parts[0]);
    } finally {
      close();
    }
  });

  it('H10 · a busy store is thrown as it is, never reported as a missing part', async () => {
    const { filed, store, close } = await setup();
    try {
      class Busy extends Error {}
      const busy = counted(store, {
        fail: (ref, verb) =>
          verb === 'get' && ref === filed.parts[0] ? new Busy('busy') : undefined,
      });
      const saved = await opened(busy.artifacts, filed.index);
      await expect(saved.readInvocation(keysIn(filed, 0)[0]!)).rejects.toBeInstanceOf(Busy);
    } finally {
      close();
    }
  });
});

describe('opening what is not a saved recording', () => {
  it('a ref outside the grammar is not-found with no call; another kind is not-a-recording', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      const view = counted(store);
      expect(await openSavedRecording(view.artifacts, 'not-a-ref')).toEqual({
        status: 'unavailable',
        reason: 'not-found',
      });
      expect(view.calls).toEqual({ head: [], get: [] });
      const ref = (
        await store.put(SCOPE, { kind: 'dataset/rows', mediaType: 'application/json', data: [] })
      ).meta.ref;
      expect(await openSavedRecording(view.artifacts, ref)).toEqual({
        status: 'unavailable',
        reason: 'not-a-recording',
      });
      const bad = (
        await store.put(SCOPE, { kind: 'recording/run', mediaType: 'application/json', data: '{' })
      ).meta.ref;
      expect(await openSavedRecording(view.artifacts, bad)).toEqual({
        status: 'unavailable',
        reason: 'invalid-recording',
      });
      await expect(openSavedRecording(view.artifacts, ref, { maxPartBytes: 0 })).rejects.toThrow(
        RangeError,
      );
    } finally {
      close();
    }
  });
});

describe('a whole recording at its bounds', () => {
  it('opens at exactly maxRootBytes and serves its root and every invocation; one byte less is too-large', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      const ref = await fileWhole(store, recording);
      const bytes = (await store.head(SCOPE, ref))!.bytes;
      const atCap = await opened(bindArtifacts(store, SCOPE), ref, { maxRootBytes: bytes });
      expect((await atCap.readRoot()).status).toBe('ready');
      for (const invocation of atCap.invocations) {
        expect((await atCap.readInvocation(invocation.key)).status, invocation.key).toBe('ready');
      }
      expect(
        await openSavedRecording(bindArtifacts(store, SCOPE), ref, { maxRootBytes: bytes - 1 }),
      ).toEqual({ status: 'unavailable', reason: 'too-large' });
    } finally {
      close();
    }
  });

  it('a whole run with no subflows at exactly maxRootBytes reads its root: the in-memory cut is not capped again', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      const bare = {
        snapshot: { runId: 'r', executionTree: { id: 'seed', name: 'seed' } },
        events: [],
        structure: { id: 'seed', name: 'seed' },
      } as unknown as Recording;
      const ref = await fileWhole(store, bare);
      const bytes = (await store.head(SCOPE, ref))!.bytes;
      const atCap = await opened(bindArtifacts(store, SCOPE), ref, { maxRootBytes: bytes });
      expect(await atCap.readRoot()).toEqual({
        status: 'ready',
        recording: JSON.parse(JSON.stringify(bare)),
      });
      // maxPartBytes bounds stored parts; the parts of an admitted whole are not stored ones.
      const wholeRef = await fileWhole(store, recording);
      const small = await opened(bindArtifacts(store, SCOPE), wholeRef, { maxPartBytes: 1024 });
      expect((await small.readInvocation(small.invocations[0]!.key)).status).toBe('ready');
    } finally {
      close();
    }
  });

  it('a hand-filed PACKED recording too deep to expand on any stack is invalid-recording, not a thrown error', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
      const text =
        `{"format":"agentfootprint.recording.packed.v1","values":[${deep}],` +
        `"recording":{"snapshot":{"runId":"r","executionTree":null},"events":[{"$af:ref":0}],"structure":{}}}`;
      const ref = (
        await store.put(SCOPE, { kind: 'recording/run', mediaType: 'application/json', data: text })
      ).meta.ref;
      expect(await openSavedRecording(bindArtifacts(store, SCOPE), ref)).toEqual({
        status: 'unavailable',
        reason: 'invalid-recording',
      });
    } finally {
      close();
    }
  });

  it('a verified packed part too deep to expand on any stack is too-large for this reader, not a thrown error', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      const filed = await fileParts(store, recording, { packed: true, targetBytes: 16 * 1024 });
      const key = keysIn(filed, 0)[0]!;
      const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
      const part =
        `{"format":"agentfootprint.recording.packed.v1","values":[${deep}],` +
        `"recording":{"format":"agentfootprint.recording.part.v1","runId":"${RUN_ID}","part":0,` +
        `"results":{${JSON.stringify(key)}:{"$af:ref":0}},"aliases":{}}}`;
      const index = await forgePart(store, filed, 0, part);
      const saved = await opened(bindArtifacts(store, SCOPE), index);
      expect(await saved.readInvocation(key)).toEqual({
        status: 'unavailable',
        reason: 'too-large',
      });
    } finally {
      close();
    }
  });

  it('a hand-filed recording nested too deep to write again is invalid-recording, not a thrown error', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      // Deep enough to overflow the serializer on every runtime, not only on a small stack.
      const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
      const text = `{"snapshot":{"runId":"r","executionTree":null},"events":[${deep}],"structure":{}}`;
      expect(() => JSON.parse(text)).not.toThrow();
      const ref = (
        await store.put(SCOPE, { kind: 'recording/run', mediaType: 'application/json', data: text })
      ).meta.ref;
      expect(await openSavedRecording(bindArtifacts(store, SCOPE), ref)).toEqual({
        status: 'unavailable',
        reason: 'invalid-recording',
      });
    } finally {
      close();
    }
  });
});
