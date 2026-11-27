/**
 * S1 · THE INDEX'S PAYLOAD FIGURES ARE CLAIMS. The index is untrusted input:
 * `restoredBytes` (per invocation and in total) and the kept counts are
 * checked against what a read measures and restores. A figure that does not
 * match is `part-changed`; a whole read never expands past `maxBytes`, however
 * the index understates; a figure a read decides from up front is provisional
 * until the measured one matches it.
 */
import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { RECORDING_INDEX_ARTIFACT_KIND } from '../../../../src/artifacts/recordingArtifact.js';
import { computeArtifactDigest } from '../../../../src/artifacts/payload.js';
import { inMemoryArtifacts } from '../../../../src/index.js';
import { utf8Length } from '../../../../src/lib/utf8.js';
import { openSavedRecording, type SavedRecording } from '../../../../src/observe.js';
import { boundaryEvents, engineRecording } from './engineRuns.js';
import { RUN_ID, SCOPE, fileParts, type FiledParts } from './helpers.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const store = inMemoryArtifacts();
// A loop: three invocations whose payloads are all `same`, restored from results.
const recording = await engineRecording('loop');
const filed: FiledParts = await fileParts(store, recording);
const honest = JSON.parse(filed.indexText) as Json;
const restored = honest.subflowPayloads.restoredBytes as number;
/** The plain bytes a whole read holds: every stored part, plus what it restores. */
const exact =
  filed.split.base.bytes + filed.split.parts.reduce((s, p) => s + p.bytes, 0) + restored;
const target = (honest.invocations as Json[]).find((row) => row.restoredBytes !== undefined)!;

/** File an index edited by `forge` beside the honest parts (or a forged base); open it. */
async function forged(
  forge: (index: Json) => void,
  base?: string,
): Promise<SavedRecording | { status: string; reason: string }> {
  const index = JSON.parse(filed.indexText) as Json;
  forge(index);
  if (base !== undefined) {
    const ref = (
      await store.put(SCOPE, {
        kind: 'recording/run-part',
        mediaType: 'application/json',
        data: base,
        digest: 'sha-256',
        origin: { runId: RUN_ID },
      })
    ).meta.ref;
    index.base = { ref, bytes: utf8Length(base), digest: await computeArtifactDigest(base) };
  }
  const ref = (
    await store.put(SCOPE, {
      kind: RECORDING_INDEX_ARTIFACT_KIND,
      mediaType: 'application/json',
      data: JSON.stringify(index),
      digest: 'sha-256',
      origin: { runId: RUN_ID },
    })
  ).meta.ref;
  return openSavedRecording(bindArtifacts(store, SCOPE), ref);
}

function ready(value: SavedRecording | { status: string; reason: string }): SavedRecording {
  if (value.status !== 'ready')
    throw new Error(`not opened: ${(value as { reason: string }).reason}`);
  return value as SavedRecording;
}

/** Move `by` bytes on the target invocation's figure and on the total, so the index stays self-consistent. */
const shift = (by: number) => (index: Json) => {
  const row = (index.invocations as Json[]).find((r) => r.key === target.key)!;
  row.restoredBytes += by;
  index.subflowPayloads.restoredBytes += by;
};

describe('an index that misstates the bytes a read restores', () => {
  it('the honest index: exactly the measured total is read; one byte less is refused', async () => {
    expect(restored).toBeGreaterThan(0);
    const saved = ready(await forged(() => {}));
    expect((await saved.readWhole({ maxBytes: exact })).status).toBe('ready');
    expect(await saved.readWhole({ maxBytes: exact - 1 })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
  });

  it('understated by one byte: never read past maxBytes, and refused as part-changed when it fits', async () => {
    const saved = ready(await forged(shift(-1)));
    expect(saved.sizes.restoredBytes).toBe(saved.sizes.storedBytes + restored - 1);
    // The figure lets the up-front check pass at exact − 1; the measured bytes do not.
    expect(await saved.readWhole({ maxBytes: exact - 1 })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
    // Within budget, the figure itself does not match what was measured.
    expect(await saved.readWhole({ maxBytes: exact })).toEqual({
      status: 'unavailable',
      reason: 'part-changed',
    });
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
    expect(await saved.readInvocation(target.key as string)).toEqual({
      status: 'unavailable',
      reason: 'part-changed',
    });
  });

  it('overstated by one byte: refused as part-changed, never served', async () => {
    const saved = ready(await forged(shift(1)));
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
    expect(await saved.readInvocation(target.key as string)).toEqual({
      status: 'unavailable',
      reason: 'part-changed',
    });
    // Up front, the overstated figure is the index's own claim: it refuses and serves no byte.
    expect(await saved.readWhole({ maxBytes: exact })).toEqual({
      status: 'unavailable',
      reason: 'too-large',
    });
  });

  it('an index that omits the figure while same payloads exist is refused at open', async () => {
    for (const forge of [
      (index: Json) => {
        const row = (index.invocations as Json[]).find((r) => r.key === target.key)!;
        index.subflowPayloads.restoredBytes -= row.restoredBytes as number;
        delete row.restoredBytes;
      },
      (index: Json) => delete index.subflowPayloads.restoredBytes,
    ]) {
      expect(await forged(forge)).toEqual({ status: 'unavailable', reason: 'invalid-index' });
    }
  });

  it('the figure moved between two invocations, the total unchanged: part-changed', async () => {
    const saved = ready(
      await forged((index) => {
        const rows = (index.invocations as Json[]).filter((r) => r.restoredBytes !== undefined);
        rows[0]!.restoredBytes += 1;
        rows[1]!.restoredBytes -= 1;
      }),
    );
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
  });
});

describe('an index that miscounts the payloads kept in the base', () => {
  it.each(['ambiguous', 'notLast', 'noPart'])(
    'kept.%s off by one: readWhole is part-changed',
    async (reason) => {
      const saved = ready(await forged((index) => (index.subflowPayloads.kept[reason] += 1)));
      expect((await saved.readRoot()).status).toBe('ready');
      expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
    },
  );

  it('counts that agree but a different set of payloads moved: the rule, run again, refuses it', async () => {
    // sf-a#9's payloads put back in the base row (no longer placed), and a second
    // sf-a#1 entry (no payload) that makes sf-a#1 ambiguous once restored: every
    // count still adds up, only the SET of moved payloads differs.
    const base = JSON.parse(filed.split.base.text) as { recording: typeof recording };
    const events = boundaryEvents(base.recording);
    const original = boundaryEvents(recording);
    for (const event of events) {
      if (event.runtimeStageId !== 'sf-a#9') continue;
      delete event.payloadWith;
      event.payload = original.find(
        (e) => e.type === event.type && e.runtimeStageId === 'sf-a#9',
      )!.payload;
    }
    const { payloadWith: _mark, ...secondEntry } = events.find(
      (e) => e.type === 'subflow.entry' && e.runtimeStageId === 'sf-a#1',
    )!;
    void _mark;
    events.push(secondEntry);
    const saved = ready(
      await forged((index) => {
        const row = (index.invocations as Json[]).find((r) => r.key === 'sf-a#9')!;
        index.subflowPayloads.same -= 2;
        index.subflowPayloads.restoredBytes -= row.restoredBytes as number;
        index.subflowPayloads.kept.ambiguous = 2;
        delete row.payloads;
        delete row.restoredBytes;
      }, JSON.stringify(base)),
    );
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
  });

  it('a marked row that names another recorder row: part-changed, never a restore elsewhere', async () => {
    const saved = ready(
      await forged((index) => (index.subflowPayloads.rows = [index.subflowPayloads.rows[0] + 1])),
    );
    expect((await saved.readRoot()).status).toBe('ready');
    expect(await saved.readWhole()).toEqual({ status: 'unavailable', reason: 'part-changed' });
  });

  it('the honest counts read back', async () => {
    const saved = ready(await forged(() => {}));
    expect((await saved.readWhole()).status).toBe('ready');
  });
});
