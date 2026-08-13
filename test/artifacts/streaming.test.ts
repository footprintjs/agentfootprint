/**
 * The OPTIONAL streaming leg of the artifact port (9.25.0).
 *
 * Two claims are being defended, and they pull against each other:
 *   • a store that CAN move bytes without holding them whole says so, and
 *     round-trips them exactly;
 *   • a store that CANNOT leaves the members ABSENT — never a fake stream over
 *     a payload it already had in memory, which would be a capability that
 *     lies about the one thing it exists to promise.
 *
 * Feature detection is therefore a first-class test, not an afterthought: a
 * consumer asks `canPutArtifactStream(store)` and the answer must match what
 * the adapter really is. The compile-time half of that claim ("calling an
 * absent member is a type error, not a runtime surprise") is pinned in
 * `test/type-regressions/ArtifactStreaming.assignability.test.ts`.
 */

import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canGetArtifactStream,
  canPutArtifactStream,
  canStreamArtifacts,
  fileArtifacts,
  gcsArtifacts,
  inMemoryArtifacts,
  InvalidArtifactError,
  s3Artifacts,
  sqliteArtifacts,
  type ArtifactScope,
  type ArtifactStore,
} from '../../src/index.js';
import { fakeGcs, fakeS3 } from './fakes/objectServices.js';

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-artifact-stream-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

const SCOPE: ArtifactScope = { conversationId: 'conv-a' };

/** A payload that arrives in pieces, like a real producer's would. */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function drain(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

// ─────────────────────────────────────────────────────────────────────
// Unit — feature detection is the contract
// ─────────────────────────────────────────────────────────────────────

describe('feature detection — presence is the promise, absence is the truth', () => {
  it('the stores that can stream say so; the ones that cannot leave it ABSENT', () => {
    const streamers: ReadonlyArray<[string, ArtifactStore]> = [
      ['fileArtifacts', fileArtifacts({ directory: tempDir() })],
      ['s3Artifacts', s3Artifacts({ bucket: 'b', _client: fakeS3().client })],
      ['gcsArtifacts', gcsArtifacts({ bucket: 'b', _storage: fakeGcs().storage })],
    ];
    for (const [name, store] of streamers) {
      expect(canPutArtifactStream(store), name).toBe(true);
      expect(canGetArtifactStream(store), name).toBe(true);
      expect(canStreamArtifacts(store), name).toBe(true);
    }

    // In-memory holds payloads whole under a byte budget — streaming into it
    // would defeat both, so it does not pretend to.
    const memory = inMemoryArtifacts();
    expect(canPutArtifactStream(memory)).toBe(false);
    expect(canGetArtifactStream(memory)).toBe(false);
    expect(memory.putStream).toBeUndefined();
    expect(memory.getStream).toBeUndefined();
  });

  it.skipIf(!sqliteAvailable)(
    'sqlite leaves them absent too — node:sqlite reads and writes a BLOB whole',
    () => {
      const store = sqliteArtifacts({ file: join(tempDir(), 'stream.db') });
      expect(canStreamArtifacts(store)).toBe(false);
      expect(store.putStream).toBeUndefined();
      store.close();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// Functional — the round trip, on every store that claims it
// ─────────────────────────────────────────────────────────────────────

type MakeStore = () => ArtifactStore;

const STREAMING_ADAPTERS: ReadonlyArray<[string, MakeStore]> = [
  ['fileArtifacts', () => fileArtifacts({ directory: tempDir() })],
  ['s3Artifacts', () => s3Artifacts({ bucket: 'b', _client: fakeS3().client })],
  ['gcsArtifacts', () => gcsArtifacts({ bucket: 'b', _storage: fakeGcs().storage })],
];

describe.each(STREAMING_ADAPTERS)('%s — putStream / getStream', (_name, makeStore) => {
  const CHUNKS = ['col_a,col_b\n', '1,2\n', '3,4\n'];
  const WHOLE = CHUNKS.join('');

  it('round-trips a streamed payload byte for byte, through both readers', async () => {
    const store = makeStore();
    if (!canStreamArtifacts(store)) throw new Error('adapter claims no streaming');
    const { meta } = await store.putStream(
      SCOPE,
      {
        kind: 'report/csv',
        mediaType: 'text/csv',
        bytes: WHOLE.length,
        label: 'Q3 export',
      },
      streamOf(CHUNKS),
    );
    expect(meta.bytes).toBe(WHOLE.length);
    expect(meta.label).toBe('Q3 export');

    // The five verbs still answer for a streamed artifact — head describes it,
    // get hands back the bytes, list carries the ticket.
    expect((await store.head(SCOPE, meta.ref))?.kind).toBe('report/csv');
    const got = await store.get(SCOPE, meta.ref);
    expect(got?.data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(got?.data as Uint8Array)).toBe(WHOLE);
    expect((await store.list(SCOPE)).artifacts.map((m) => m.ref)).toEqual([meta.ref]);

    const streamed = await store.getStream(SCOPE, meta.ref);
    expect(await drain(streamed!.body)).toBe(WHOLE);
  });

  it('getStream answers null for missing-or-expired, exactly like get', async () => {
    const store = makeStore();
    if (!canGetArtifactStream(store)) throw new Error('adapter claims no streaming');
    expect(await store.getStream(SCOPE, 'art_' + 'a'.repeat(22))).toBeNull();
    expect(await store.getStream(SCOPE, 'not-a-ref')).toBeNull();
  });

  it('a payload that does not match its declared bytes is REFUSED, not stored', async () => {
    const store = makeStore();
    if (!canPutArtifactStream(store)) throw new Error('adapter claims no streaming');
    const input = { kind: 'report/csv', mediaType: 'text/csv', bytes: 999 };
    await expect(store.putStream(SCOPE, input, streamOf(CHUNKS))).rejects.toThrow(
      /declared|longer than/,
    );
    // Nothing was admitted under a meta that misdescribes its own payload.
    expect((await store.list(SCOPE)).artifacts).toEqual([]);
  });

  it('a stated bytes that is not a number is refused before anything is stored', async () => {
    const store = makeStore();
    if (!canPutArtifactStream(store)) throw new Error('adapter claims no streaming');
    await expect(
      store.putStream(
        SCOPE,
        { kind: 'k', mediaType: 't', bytes: undefined as unknown as number },
        streamOf(['x']),
      ),
    ).rejects.toThrow(InvalidArtifactError);
  });

  it('retention plans against the DECLARED bytes, before the first chunk', async () => {
    const store = makeStore();
    if (!canPutArtifactStream(store)) throw new Error('adapter claims no streaming');
    const { meta } = await store.putStream(
      SCOPE,
      { kind: 'report/csv', mediaType: 'text/csv', bytes: WHOLE.length },
      streamOf(CHUNKS),
    );
    // The ticket's own accounting is the declared length — the number every
    // budget, every listing and every consumer reads.
    expect((await store.head(SCOPE, meta.ref))?.bytes).toBe(WHOLE.length);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration — what the directory store does on disk
// ─────────────────────────────────────────────────────────────────────

describe('fileArtifacts — the sibling payload file', () => {
  const scopeFiles = (dir: string): string[] => readdirSync(join(dir, '_', '_', 'conv-a')).sort();

  it('writes <ref>.bin then the envelope, and deletes both together', async () => {
    const dir = tempDir();
    const store = fileArtifacts({ directory: dir });
    if (!canPutArtifactStream(store)) throw new Error('no streaming');
    const { meta } = await store.putStream(
      SCOPE,
      { kind: 'report/csv', mediaType: 'text/csv', bytes: 4 },
      streamOf(['abcd']),
    );
    expect(scopeFiles(dir)).toEqual([`${meta.ref}.bin`, `${meta.ref}.json`]);
    await store.delete(SCOPE, meta.ref);
    expect(scopeFiles(dir)).toEqual([]); // no orphan bytes left paying for storage
  });

  it('a refused stream leaves NOTHING behind — not even the partial bytes', async () => {
    const dir = tempDir();
    const store = fileArtifacts({ directory: dir });
    if (!canPutArtifactStream(store)) throw new Error('no streaming');
    await expect(
      store.putStream(SCOPE, { kind: 'k', mediaType: 't', bytes: 100 }, streamOf(['short'])),
    ).rejects.toThrow(InvalidArtifactError);
    expect(scopeFiles(dir)).toEqual([]);
  });

  it('getStream also answers for an INLINE artifact — the canonical bytes, one chunk', async () => {
    const store = fileArtifacts({ directory: tempDir() });
    if (!canStreamArtifacts(store)) throw new Error('no streaming');
    const { meta } = await store.put(SCOPE, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: { n: 7 },
    });
    const streamed = await store.getStream(SCOPE, meta.ref);
    // The SAME bytes `meta.bytes` counts and a digest would cover — never a
    // re-encoding, so a streamed read and a digest cannot disagree.
    expect(await drain(streamed!.body)).toBe('{"n":7}');
    expect(streamed!.meta.bytes).toBe('{"n":7}'.length);
  });

  it('expiry sweeps the sibling payload too', async () => {
    const dir = tempDir();
    let at = 1_000_000;
    const store = fileArtifacts({ directory: dir, _now: () => at });
    if (!canPutArtifactStream(store)) throw new Error('no streaming');
    const { meta } = await store.putStream(
      SCOPE,
      { kind: 'k', mediaType: 't', bytes: 4, expiresAt: at + 50 },
      streamOf(['abcd']),
    );
    expect(scopeFiles(dir)).toHaveLength(2);
    at += 51;
    expect(await store.head(SCOPE, meta.ref)).toBeNull();
    expect(scopeFiles(dir)).toEqual([]);
  });
});
