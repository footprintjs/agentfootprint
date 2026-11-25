/**
 * THE DEFENCES, ONE BY ONE — each case below defeats every check but the one
 * it names, so removing that check makes the case fail:
 *
 *   • the digest: a same-length alteration (the byte count still matches), and
 *     a ticket that reports another digest (refused before its `get`);
 *   • the key set: a part consistent with its index on the digest, but holding
 *     one key more or one key less than the index lists;
 *   • the run: a part ticket stamped for another run, and a payload that names
 *     another run;
 *   • the ticket: a `head` that answers for another ref, or with a size that is
 *     not a size (refused before any `get`);
 *   • the whole layout's own length and digest checks;
 *   • store failures from `head` and from `get`, for the index, the base and a
 *     part: each rethrown as it is;
 *   • a read without its own signal honours the open call's signal.
 */
import { describe, expect, it } from 'vitest';

import { recordingPutInput } from '../../../../src/artifacts/recordingArtifact.js';
import type { ArtifactStore } from '../../../../src/artifacts/types.js';
import { openSavedRecording, type SavedRecording } from '../../../../src/observe.js';
import {
  RUN_ID,
  SCOPE,
  STORES,
  alterSameLength,
  counted,
  fileParts,
  fileWhole,
  forgePart,
  realRecording,
  type FiledParts,
} from './helpers.js';

const recording = await realRecording();

function keysIn(filed: FiledParts, part: number): string[] {
  const rows = JSON.parse(filed.indexText) as { invocations: { key: string; part: number }[] };
  return rows.invocations.filter((row) => row.part === part).map((row) => row.key);
}

async function opened(
  artifacts: Parameters<typeof openSavedRecording>[0],
  ref: string,
): Promise<SavedRecording> {
  const result = await openSavedRecording(artifacts, ref);
  if (result.status !== 'ready') throw new Error(`not opened: ${result.reason}`);
  return result;
}

const CHANGED = { status: 'unavailable', reason: 'part-changed' };

describe.each(STORES)('each defence holds on its own — $name', (storeCase) => {
  async function setup(): Promise<{ filed: FiledParts; store: ArtifactStore; close(): void }> {
    const { store, close } = storeCase.create();
    const filed = await fileParts(store, recording, { targetBytes: 16 * 1024 });
    return { filed, store, close };
  }
  /** The first part that holds at least two invocations. */
  const roomy = (filed: FiledParts): number =>
    filed.parts.findIndex((_, at) => keysIn(filed, at).length >= 2);

  it('the digest · a same-length change to an invocation part is part-changed', async () => {
    const { filed, store, close } = await setup();
    try {
      const target = filed.parts[0]!;
      const view = counted(store, {
        data: (record) =>
          record.meta.ref === target
            ? alterSameLength(record.data as string, '"subflowName":"')
            : record.data,
      });
      const saved = await opened(view.artifacts, filed.index);
      for (const key of keysIn(filed, 0)) expect(await saved.readInvocation(key)).toEqual(CHANGED);
      expect((await saved.readInvocation(keysIn(filed, 1)[0]!)).status).toBe('ready');
    } finally {
      close();
    }
  });

  it('the digest · a same-length change to the base part is part-changed', async () => {
    const { filed, store, close } = await setup();
    try {
      const view = counted(store, {
        data: (record) =>
          record.meta.ref === filed.base
            ? alterSameLength(record.data as string, '"name":"')
            : record.data,
      });
      const saved = await opened(view.artifacts, filed.index);
      expect(await saved.readRoot()).toEqual(CHANGED);
    } finally {
      close();
    }
  });

  it('the digest · a ticket that reports another digest is part-changed before its get', async () => {
    const { filed, store, close } = await setup();
    try {
      const target = filed.parts[0]!;
      const view = counted(store, {
        meta: (meta) =>
          meta.ref === target ? { ...meta, digest: `sha-256:${'0'.repeat(64)}` } : meta,
      });
      const saved = await opened(view.artifacts, filed.index);
      expect(await saved.readInvocation(keysIn(filed, 0)[0]!)).toEqual(CHANGED);
      expect(view.calls.get).not.toContain(target);
    } finally {
      close();
    }
  });

  it('the key set · a part holding one key more than its index lists is part-changed', async () => {
    const { filed, store, close } = await setup();
    try {
      const at = roomy(filed);
      const payload = JSON.parse(filed.split.parts[at]!.text) as {
        results: Record<string, unknown>;
      };
      const [first] = Object.keys(payload.results);
      payload.results['extra-mount#9999'] = payload.results[first!];
      const index = await forgePart(store, filed, at, JSON.stringify(payload));
      const saved = await opened(counted(store).artifacts, index);
      expect(await saved.readInvocation(first!)).toEqual(CHANGED);
    } finally {
      close();
    }
  });

  it('the key set · a part missing one key its index lists is part-changed for the keys it holds', async () => {
    const { filed, store, close } = await setup();
    try {
      const at = roomy(filed);
      const payload = JSON.parse(filed.split.parts[at]!.text) as {
        results: Record<string, unknown>;
      };
      const [kept, dropped] = Object.keys(payload.results);
      delete payload.results[dropped!];
      const index = await forgePart(store, filed, at, JSON.stringify(payload));
      const saved = await opened(counted(store).artifacts, index);
      expect(await saved.readInvocation(kept!)).toEqual(CHANGED);
    } finally {
      close();
    }
  });

  it('the run · a part ticket stamped for another run is part-changed before its get', async () => {
    const { filed, store, close } = await setup();
    try {
      const target = filed.parts[0]!;
      const view = counted(store, {
        meta: (meta) =>
          meta.ref === target ? { ...meta, origin: { runId: 'another-run' } } : meta,
      });
      const saved = await opened(view.artifacts, filed.index);
      expect(await saved.readInvocation(keysIn(filed, 0)[0]!)).toEqual(CHANGED);
      expect(view.calls.get).not.toContain(target);
    } finally {
      close();
    }
  });

  it('the run · a part whose payload names another run is part-changed', async () => {
    const { filed, store, close } = await setup();
    try {
      const payload = JSON.parse(filed.split.parts[0]!.text) as { runId: string };
      payload.runId = 'another-run';
      const index = await forgePart(store, filed, 0, JSON.stringify(payload));
      const saved = await opened(counted(store).artifacts, index);
      expect(await saved.readInvocation(keysIn(filed, 0)[0]!)).toEqual(CHANGED);
    } finally {
      close();
    }
  });

  it('the ticket · a head answering for another ref is refused, with no get', async () => {
    const { filed, store, close } = await setup();
    try {
      const other = filed.parts[1]!;
      const index = counted(store, {
        meta: (meta) => (meta.ref === filed.index ? { ...meta, ref: other } : meta),
      });
      expect(await openSavedRecording(index.artifacts, filed.index)).toEqual({
        status: 'unavailable',
        reason: 'invalid-index',
      });
      expect(index.calls.get).toEqual([]);

      const target = filed.parts[0]!;
      const part = counted(store, {
        meta: (meta) => (meta.ref === target ? { ...meta, ref: other } : meta),
      });
      const saved = await opened(part.artifacts, filed.index);
      const gets = part.calls.get.length;
      expect(await saved.readInvocation(keysIn(filed, 0)[0]!)).toEqual(CHANGED);
      // Refused at the head: no get at all, of the asked ref or of the one the ticket named.
      expect(part.calls.get.length).toBe(gets);
    } finally {
      close();
    }
  });

  it('the ticket · a size that is not a size is refused before any get', async () => {
    const { filed, store, close } = await setup();
    try {
      const wholeRef = await fileWhole(store, recording);
      for (const bytes of [Number.NaN, -1, 1.5, '10', undefined]) {
        for (const [ref, reason] of [
          [filed.index, 'invalid-index'],
          [wholeRef, 'invalid-recording'],
        ] as const) {
          const view = counted(store, {
            meta: (meta) => (meta.ref === ref ? { ...meta, bytes: bytes as number } : meta),
          });
          expect(await openSavedRecording(view.artifacts, ref, { maxIndexBytes: 10 })).toEqual({
            status: 'unavailable',
            reason,
          });
          expect(view.calls.get).toEqual([]);
        }
      }
    } finally {
      close();
    }
  });

  it('the whole layout · a length change is invalid-recording even when the store kept no digest', async () => {
    const { store, close } = await setup();
    try {
      const input = recordingPutInput(recording, { runId: RUN_ID });
      const ref = (await store.put(SCOPE, input)).meta.ref;
      expect((await store.head(SCOPE, ref))!.digest).toBeUndefined();
      const view = counted(store, {
        data: (record) => (record.meta.ref === ref ? `${record.data as string} ` : record.data),
      });
      expect(await openSavedRecording(view.artifacts, ref)).toEqual({
        status: 'unavailable',
        reason: 'invalid-recording',
      });
    } finally {
      close();
    }
  });

  it('the whole layout · a same-length change and a length change are invalid-recording', async () => {
    const { store, close } = await setup();
    try {
      const wholeRef = await fileWhole(store, recording);
      const changes = [
        (text: string) => alterSameLength(text, '"name":"'),
        (text: string) => `${text} `,
      ];
      for (const change of changes) {
        const view = counted(store, {
          data: (record) =>
            record.meta.ref === wholeRef ? change(record.data as string) : record.data,
        });
        expect(await openSavedRecording(view.artifacts, wholeRef)).toEqual({
          status: 'unavailable',
          reason: 'invalid-recording',
        });
      }
    } finally {
      close();
    }
  });

  it('store failures · a throwing head or get, for the index, the base and a part, is rethrown', async () => {
    const { filed, store, close } = await setup();
    try {
      class StoreDown extends Error {}
      const key = keysIn(filed, 0)[0]!;
      for (const verb of ['head', 'get'] as const) {
        const failing = (ref: string) =>
          counted(store, {
            fail: (asked, used) =>
              asked === ref && used === verb ? new StoreDown(verb) : undefined,
          }).artifacts;
        await expect(openSavedRecording(failing(filed.index), filed.index)).rejects.toBeInstanceOf(
          StoreDown,
        );
        const onBase = await opened(failing(filed.base), filed.index);
        await expect(onBase.readRoot()).rejects.toBeInstanceOf(StoreDown);
        await expect(onBase.readWhole()).rejects.toBeInstanceOf(StoreDown);
        const onPart = await opened(failing(filed.parts[0]!), filed.index);
        await expect(onPart.readInvocation(key)).rejects.toBeInstanceOf(StoreDown);
      }
    } finally {
      close();
    }
  });

  it("a read without its own signal honours the open call's signal", async () => {
    const { filed, store, close } = await setup();
    try {
      const controller = new AbortController();
      const view = counted(store);
      const result = await openSavedRecording(view.artifacts, filed.index, {
        signal: controller.signal,
      });
      if (result.status !== 'ready') throw new Error(result.reason);
      const before = view.calls.head.length + view.calls.get.length;
      controller.abort(new Error('the request ended'));
      await expect(result.readInvocation(keysIn(filed, 0)[0]!)).rejects.toThrow(
        'the request ended',
      );
      await expect(result.readRoot()).rejects.toThrow('the request ended');
      expect(view.calls.head.length + view.calls.get.length).toBe(before);
      // Its own signal, when given, decides instead.
      const fresh = new AbortController();
      expect(
        (await result.readInvocation(keysIn(filed, 0)[0]!, { signal: fresh.signal })).status,
      ).toBe('ready');
    } finally {
      close();
    }
  });
});
