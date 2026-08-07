/**
 * The durable index (8.9.0) — the R2 test slice.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * What this file exists to pin:
 *
 *   1. **Restart survival.** Index, close, reopen, search — same top-K, and
 *      ZERO re-embeds. That is the entire reason a file beats a `Map`, and it
 *      is the headline test.
 *   2. The store is a REAL `MemoryStore` — all eleven methods, against the same
 *      contract `InMemoryStore` answers, so swapping one for the other changes
 *      durability and nothing else.
 *   3. Two embedding spaces never mix. Refused at write AND at query, by name.
 *   4. A file that is not ours, or newer than us, is refused rather than read
 *      as empty.
 *
 * `node:sqlite` ships with Node 22.5+. The refusal tests run EVERYWHERE,
 * including on a Node that has no such module — they are the part that matters
 * most to a consumer who cannot use this store at all. The tests that need a
 * real file are skipped when the module is missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sqliteVectorStore,
  UnreadableIndexFileError,
  EmbedderMismatchError,
  SqliteUnavailableError,
  type SqliteVectorStore,
} from '../../src/memory-providers.js';
import { InMemoryStore, mockEmbedder } from '../../src/memory/index.js';
import type { MemoryEntry } from '../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../src/memory/identity/index.js';

/** Does this Node have the module at all? Node 20 does not. */
const HAS_SQLITE = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (
      typeof (require('node:sqlite') as { DatabaseSync?: unknown }).DatabaseSync === 'function'
    );
  } catch {
    return false;
  }
})();

const describeWithSqlite = HAS_SQLITE ? describe : describe.skip;

const CORPUS: MemoryIdentity = { conversationId: '_global' };

let dir: string;
const opened: SqliteVectorStore[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'af-vec-'));
});

afterEach(() => {
  for (const store of opened.splice(0)) {
    try {
      store.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function open(name = 'corpus.db'): SqliteVectorStore {
  const store = sqliteVectorStore({ file: join(dir, name) });
  opened.push(store);
  return store;
}

function entry(
  id: string,
  embedding: number[] | undefined,
  extra: Partial<MemoryEntry<unknown>> = {},
): MemoryEntry<unknown> {
  const now = Date.now();
  return {
    id,
    value: { id, content: `content of ${id}`, metadata: { source: `${id}.md` } },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...(embedding && { embedding }),
    ...extra,
  } as MemoryEntry<unknown>;
}

// ─── Refusal — runs on EVERY Node, including one with no sqlite ─────

describe('sqliteVectorStore — refusals that must hold everywhere', () => {
  it("refuses ':memory:' and points at the store that says so in its name", () => {
    expect(() => sqliteVectorStore({ file: ':memory:' })).toThrow(/InMemoryStore/);
    expect(() => sqliteVectorStore({ file: ':memory:' })).toThrow(/re-embed the whole corpus/);
  });

  it('refuses an empty path', () => {
    expect(() => sqliteVectorStore({ file: '   ' })).toThrow(TypeError);
  });

  it('the no-sqlite refusal names the version, the flag, and why it does not fall back', () => {
    // On Node 20 this is not a simulation: it is what every caller meets. The
    // message is the whole deliverable, so it is asserted piece by piece.
    const refusal = new SqliteUnavailableError('v20.19.1', 'No such built-in module: node:sqlite', {
      door: 'memory',
      factory: 'sqliteVectorStore()',
      alternative: 'InMemoryStore — which keeps the index in a Map',
      whyNotFallback:
        'an index that silently forgot every document on restart looks like a corpus that was never built',
    });
    expect(refusal.code).toBe('ERR_SQLITE_UNAVAILABLE');
    expect(refusal.name).toBe('SqliteUnavailableError');
    expect(refusal.nodeVersion).toBe('v20.19.1');
    expect(refusal.message).toContain('sqliteVectorStore()');
    expect(refusal.message).toContain('22.5');
    expect(refusal.message).toContain('--experimental-sqlite');
    expect(refusal.message).toContain('InMemoryStore');
    expect(refusal.message).toContain('never built');
  });

  it('raises that refusal on the real load path, and touches no disk on the way', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/lazyRequire.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/lib/lazyRequire.js')>(
        '../../src/lib/lazyRequire.js',
      );
      return {
        lazyRequire: (specifier: string): unknown => {
          if (specifier === 'node:sqlite') {
            throw new Error('No such built-in module: node:sqlite');
          }
          return actual.lazyRequire(specifier);
        },
      };
    });
    try {
      const fresh = await import('../../src/adapters/memory/sqliteVector.js');
      const file = join(dir, 'never', 'created.db');
      // `vi.resetModules` gives the re-imported module its own copy of the
      // class, so `instanceof` against the statically imported one is a lie
      // about module graphs, not about behaviour. Assert what a consumer
      // actually branches on.
      try {
        fresh.sqliteVectorStore({ file });
        expect.unreachable('should have refused');
      } catch (err) {
        expect((err as Error).name).toBe('SqliteUnavailableError');
        expect((err as { code?: string }).code).toBe('ERR_SQLITE_UNAVAILABLE');
        expect((err as Error).message).toContain('sqliteVectorStore()');
      }
      // The refusal comes BEFORE the filesystem is touched.
      expect(existsSync(join(dir, 'never'))).toBe(false);
    } finally {
      vi.doUnmock('../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('the embedder-mismatch refusal names both fingerprints and the named fix', () => {
    const refusal = new EmbedderMismatchError(
      '_/_/_global',
      'static:potion@256',
      'openai:text-embedding-3-small@1536',
      'dimensions',
      'search',
    );
    expect(refusal.code).toBe('ERR_EMBEDDER_MISMATCH');
    expect(refusal.indexed).toBe('static:potion@256');
    expect(refusal.incoming).toBe('openai:text-embedding-3-small@1536');
    expect(refusal.message).toContain('static:potion@256');
    expect(refusal.message).toContain('openai:text-embedding-3-small@1536');
    expect(refusal.message).toContain('Re-index this namespace'); // the named fix
    expect(refusal.message).toContain('a bill you did not agree to'); // why not re-embed for you
    expect(refusal.message).toContain('cannot be compared at all'); // the dimensions case
  });

  it('a same-dimension model swap says why a number that LOOKS fine is not', () => {
    const refusal = new EmbedderMismatchError(
      '_/_/_global',
      'mock@384',
      'local:MiniLM:q8@384',
      'model',
      'write to',
    );
    expect(refusal.message).toContain('is not a signal');
    expect(refusal.message).toContain('no threshold can separate');
  });
});

// ─── Unit — the MemoryStore contract, method by method ─────────────

describeWithSqlite('sqliteVectorStore — the MemoryStore contract', () => {
  it('round-trips an entry exactly, embedding included', async () => {
    const store = open();
    const vec = [0.1, 0.2, 0.3, 0.4];
    await store.put(CORPUS, entry('a', vec, { tier: 'hot', metadata: { k: 'v' } }));
    const got = await store.get(CORPUS, 'a');
    expect(got?.id).toBe('a');
    expect(got?.tier).toBe('hot');
    expect(got?.metadata).toEqual({ k: 'v' });
    // Float32 storage, so the values round-trip to float precision — the point
    // is that the ORIGINAL vector comes back, not the normalised one search uses.
    expect(got?.embedding?.length).toBe(4);
    for (let i = 0; i < 4; i++) expect(got?.embedding?.[i]).toBeCloseTo(vec[i]!, 6);
  });

  it('get returns null for a missing entry and for an expired one', async () => {
    const store = open();
    expect(await store.get(CORPUS, 'nope')).toBeNull();
    await store.put(CORPUS, entry('gone', [1, 0], { ttl: Date.now() - 1 }));
    expect(await store.get(CORPUS, 'gone')).toBeNull();
  });

  it('putMany is a no-op on an empty batch — callers rely on skipping the round-trip', async () => {
    const store = open();
    await expect(store.putMany(CORPUS, [])).resolves.toBeUndefined();
    expect((await store.list(CORPUS)).entries.length).toBe(0);
  });

  it('putIfVersion applies on a match, refuses on a stale version, and reports the current one', async () => {
    const store = open();
    expect((await store.putIfVersion(CORPUS, entry('a', [1, 0]), 0)).applied).toBe(true);
    const stale = await store.putIfVersion(CORPUS, { ...entry('a', [1, 0]), version: 2 }, 5);
    expect(stale.applied).toBe(false);
    expect(stale.currentVersion).toBe(1);
    const fresh = await store.putIfVersion(CORPUS, { ...entry('a', [1, 0]), version: 2 }, 1);
    expect(fresh.applied).toBe(true);
    expect((await store.get(CORPUS, 'a'))?.version).toBe(2);
  });

  it('putIfVersion with expectedVersion 0 refuses when the entry already exists', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0]));
    expect((await store.putIfVersion(CORPUS, entry('a', [1, 0]), 0)).applied).toBe(false);
  });

  it('list pages with a cursor and filters expired + tiered entries', async () => {
    const store = open();
    await store.putMany(CORPUS, [
      entry('a', [1, 0], { tier: 'hot' }),
      entry('b', [0, 1], { tier: 'cold' }),
      entry('c', [1, 1]),
      entry('d', [1, 1], { ttl: Date.now() - 1 }),
    ]);
    const page1 = await store.list(CORPUS, { limit: 2 });
    expect(page1.entries.length).toBe(2);
    expect(page1.cursor).toBeDefined();
    const page2 = await store.list(CORPUS, { limit: 2, cursor: page1.cursor });
    // 'd' expired, so the second page carries only 'c'.
    expect(page2.entries.map((e) => e.id)).toEqual(['c']);
    const hot = await store.list(CORPUS, { tiers: ['hot'] });
    expect(hot.entries.map((e) => e.id)).toEqual(['a']);
  });

  it('seen / recordSignature answer the recognition question', async () => {
    const store = open();
    expect(await store.seen(CORPUS, 'sig')).toBe(false);
    await store.recordSignature(CORPUS, 'sig');
    expect(await store.seen(CORPUS, 'sig')).toBe(true);
    // Idempotent — a repeated signature is not an error.
    await expect(store.recordSignature(CORPUS, 'sig')).resolves.toBeUndefined();
  });

  it('feedback aggregates, clamps, and rejects non-finite values', async () => {
    const store = open();
    expect(await store.getFeedback(CORPUS, 'a')).toBeNull();
    await store.feedback(CORPUS, 'a', 1);
    await store.feedback(CORPUS, 'a', 0);
    expect(await store.getFeedback(CORPUS, 'a')).toEqual({ average: 0.5, count: 2 });
    await store.feedback(CORPUS, 'a', 99); // clamped to 1
    expect((await store.getFeedback(CORPUS, 'a'))?.average).toBeCloseTo(2 / 3, 6);
    await store.feedback(CORPUS, 'a', Number.NaN); // rejected, not stored
    expect((await store.getFeedback(CORPUS, 'a'))?.count).toBe(3);
  });

  it('delete removes one entry; forget removes the whole namespace', async () => {
    const store = open();
    await store.putMany(CORPUS, [entry('a', [1, 0]), entry('b', [0, 1])]);
    await store.recordSignature(CORPUS, 'sig');
    await store.delete(CORPUS, 'a');
    expect(await store.get(CORPUS, 'a')).toBeNull();
    expect(await store.get(CORPUS, 'b')).not.toBeNull();
    await store.forget(CORPUS);
    expect((await store.list(CORPUS)).entries.length).toBe(0);
    expect(await store.seen(CORPUS, 'sig')).toBe(false);
    // The fingerprint goes with it — a forgotten namespace can be rebuilt by
    // any embedder, which is the whole point of the named fix.
    expect(store.fingerprintOf(CORPUS)).toBeUndefined();
  });

  it('reports the journal mode the file ACTUALLY got, read back from SQLite', () => {
    expect(open().journalMode).toBe('wal');
  });
});

// ─── Boundary — search edges ───────────────────────────────────────

describeWithSqlite('sqliteVectorStore — search boundaries', () => {
  it('an empty namespace returns [] rather than throwing', async () => {
    expect(await open().search!(CORPUS, [1, 0, 0])).toEqual([]);
  });

  it('entries with no embedding are ignored, not errored', async () => {
    const store = open();
    await store.putMany(CORPUS, [entry('vec', [1, 0]), entry('novec', undefined)]);
    const hits = await store.search!(CORPUS, [1, 0], { k: 10 });
    expect(hits.map((h) => h.entry.id)).toEqual(['vec']);
  });

  it('a zero-magnitude vector is skipped — it cannot be scored, and 0/0 is not a ranking', async () => {
    const store = open();
    await store.putMany(CORPUS, [entry('zero', [0, 0]), entry('real', [1, 0])]);
    const hits = await store.search!(CORPUS, [1, 0], { k: 10 });
    expect(hits.map((h) => h.entry.id)).toEqual(['real']);
  });

  it('a zero-magnitude QUERY returns [] rather than NaN scores', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0]));
    expect(await store.search!(CORPUS, [0, 0])).toEqual([]);
  });

  it('expired entries are omitted from search, without a rebuild', async () => {
    const store = open();
    await store.putMany(CORPUS, [
      entry('live', [1, 0]),
      entry('dead', [1, 0], { ttl: Date.now() - 1 }),
    ]);
    const hits = await store.search!(CORPUS, [1, 0], { k: 10 });
    expect(hits.map((h) => h.entry.id)).toEqual(['live']);
  });

  it('k caps the result, minScore floors it, tiers filter it', async () => {
    const store = open();
    await store.putMany(CORPUS, [
      entry('near', [1, 0], { tier: 'hot' }),
      entry('mid', [0.7, 0.7]),
      entry('far', [0, 1]),
    ]);
    expect((await store.search!(CORPUS, [1, 0], { k: 2 })).length).toBe(2);
    const floored = await store.search!(CORPUS, [1, 0], { k: 10, minScore: 0.9 });
    expect(floored.map((h) => h.entry.id)).toEqual(['near']);
    const hot = await store.search!(CORPUS, [1, 0], { k: 10, tiers: ['hot'] });
    expect(hot.map((h) => h.entry.id)).toEqual(['near']);
  });
});

// ─── Scenario — the headline ───────────────────────────────────────

describeWithSqlite('sqliteVectorStore — scenario', () => {
  it('RESTART SURVIVAL: index, close, reopen — same top-K, and ZERO re-embeds', async () => {
    const file = join(dir, 'restart.db');
    const docs = [
      { id: 'refunds.md#0', text: 'Refunds are processed within 3 business days of approval.' },
      { id: 'pricing.md#0', text: 'The Pro plan costs $20 per month.' },
      { id: 'security.md#0', text: 'All data is encrypted at rest using AES-256.' },
    ];

    // A counting embedder: every call it makes is visible, which is the only
    // way to assert that the second process makes none for the corpus.
    let embedCalls = 0;
    const base = mockEmbedder();
    const counting = {
      dimensions: base.dimensions,
      id: base.id,
      async embed(args: { text: string }): Promise<number[]> {
        embedCalls += 1;
        return base.embed(args);
      },
    };

    // ── Process 1: build the index.
    const first = sqliteVectorStore({ file });
    const now = Date.now();
    for (const doc of docs) {
      await first.put(CORPUS, {
        id: doc.id,
        value: { id: doc.id, content: doc.text },
        version: 1,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        embedding: await counting.embed({ text: doc.text }),
        embeddingModel: counting.id,
      });
    }
    const indexCost = embedCalls;
    expect(indexCost).toBe(3);

    const query = await counting.embed({ text: 'How long do refunds take?' });
    const before = await first.search!(CORPUS, query, { k: 3, embedderId: counting.id });
    first.close();

    // ── Process 2: a brand-new store object over the same file. Nothing is
    // shared but the bytes on disk.
    embedCalls = 0;
    const second = sqliteVectorStore({ file });
    opened.push(second);
    const query2 = await counting.embed({ text: 'How long do refunds take?' });
    const after = await second.search!(CORPUS, query2, { k: 3, embedderId: counting.id });

    // Identical ranking AND identical scores — the vectors were read, not remade.
    expect(after.map((h) => h.entry.id)).toEqual(before.map((h) => h.entry.id));
    for (let i = 0; i < after.length; i++) {
      expect(after[i]!.score).toBeCloseTo(before[i]!.score, 6);
    }
    // THE claim: reopening cost one embedding — the QUERY — and not one document.
    expect(embedCalls).toBe(1);
    // And the payloads survived, not just the vectors.
    expect((await second.get(CORPUS, 'refunds.md#0'))?.value).toEqual({
      id: 'refunds.md#0',
      content: docs[0]!.text,
    });
  });

  it('answers the same top-K as InMemoryStore for the same corpus', async () => {
    // Swapping the store must change durability and nothing else.
    const sqlite = open();
    const memory = new InMemoryStore();
    const rows = [
      entry('a', [1, 0, 0]),
      entry('b', [0.9, 0.4, 0]),
      entry('c', [0, 1, 0]),
      entry('d', [0, 0, 1]),
    ];
    await sqlite.putMany(CORPUS, rows);
    await memory.putMany(CORPUS, rows);

    const query = [0.95, 0.3, 0];
    const fromSqlite = await sqlite.search!(CORPUS, query, { k: 3 });
    const fromMemory = await memory.search!(CORPUS, query, { k: 3 });
    expect(fromSqlite.map((h) => h.entry.id)).toEqual(fromMemory.map((h) => h.entry.id));
    for (let i = 0; i < fromSqlite.length; i++) {
      expect(fromSqlite[i]!.score).toBeCloseTo(fromMemory[i]!.score, 5);
    }
  });

  it('warm() pays the hydration cost at a time you chose, and changes no result', async () => {
    const store = open();
    await store.putMany(CORPUS, [entry('a', [1, 0]), entry('b', [0, 1]), entry('c', [1, 1])]);

    const warmed = await store.warm(CORPUS);
    expect(warmed.count).toBe(3);
    expect(typeof warmed.durationMs).toBe('number');

    // Idempotent, and a warmed store answers exactly what a cold one does —
    // it just answers the first question faster.
    expect((await store.warm(CORPUS)).count).toBe(3);
    const cold = open('cold.db');
    await cold.putMany(CORPUS, [entry('a', [1, 0]), entry('b', [0, 1]), entry('c', [1, 1])]);
    expect((await store.search!(CORPUS, [1, 0], { k: 3 })).map((h) => h.entry.id)).toEqual(
      (await cold.search!(CORPUS, [1, 0], { k: 3 })).map((h) => h.entry.id),
    );
  });

  it('warm() on an empty namespace reports zero rather than refusing', async () => {
    expect((await open().warm(CORPUS)).count).toBe(0);
  });

  it('a write invalidates the warm matrix, so the next search sees it', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0]));
    expect((await store.search!(CORPUS, [1, 0], { k: 10 })).length).toBe(1); // hydrates
    await store.put(CORPUS, entry('b', [1, 0]));
    expect((await store.search!(CORPUS, [1, 0], { k: 10 })).length).toBe(2); // rebuilt
    await store.delete(CORPUS, 'a');
    expect((await store.search!(CORPUS, [1, 0], { k: 10 })).length).toBe(1); // rebuilt again
  });

  it('putMany is ONE transaction — a mid-batch refusal leaves nothing behind', async () => {
    const store = open();
    await store.put(CORPUS, entry('seed', [1, 0], { embeddingModel: 'mock' } as never));
    // The third entry is from a different space; the batch must not land the
    // first two. A half-indexed corpus keeps answering and quietly cannot see
    // what did not land, which reads as "the model does not know that".
    await expect(
      store.putMany(CORPUS, [
        entry('x', [0, 1], { embeddingModel: 'mock' } as never),
        entry('y', [1, 1], { embeddingModel: 'mock' } as never),
        entry('z', [1, 1, 1], { embeddingModel: 'other' } as never),
      ]),
    ).rejects.toThrow(EmbedderMismatchError);
    expect(await store.get(CORPUS, 'x')).toBeNull();
    expect(await store.get(CORPUS, 'y')).toBeNull();
    expect(await store.get(CORPUS, 'seed')).not.toBeNull();
  });
});

// ─── Property — invariants across inputs ───────────────────────────

describeWithSqlite('sqliteVectorStore — property', () => {
  it('scores match hand-computed cosine, for every query in a set', async () => {
    const store = open();
    const vectors: Record<string, number[]> = {
      a: [1, 2, 3, 4],
      b: [-1, 0, 2, 1],
      c: [0.5, 0.5, 0.5, 0.5],
    };
    await store.putMany(
      CORPUS,
      Object.entries(vectors).map(([id, v]) => entry(id, v)),
    );

    const cosine = (x: number[], y: number[]): number => {
      let dot = 0;
      let nx = 0;
      let ny = 0;
      for (let i = 0; i < x.length; i++) {
        dot += x[i]! * y[i]!;
        nx += x[i]! * x[i]!;
        ny += y[i]! * y[i]!;
      }
      return dot / (Math.sqrt(nx) * Math.sqrt(ny));
    };

    for (const query of [
      [1, 0, 0, 0],
      [0.3, -0.7, 1, 2],
      [5, 5, 5, 5],
    ]) {
      const hits = await store.search!(CORPUS, query, { k: 3 });
      expect(hits.length).toBe(3);
      for (const hit of hits) {
        expect(hit.score).toBeCloseTo(cosine(vectors[hit.entry.id]!, query), 5);
      }
      // And descending, always.
      for (let i = 1; i < hits.length; i++) {
        expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
      }
    }
  });

  it('ties break by id, so a replayed trace ranks identically', async () => {
    const store = open();
    await store.putMany(CORPUS, [entry('zebra', [1, 0]), entry('alpha', [1, 0])]);
    const hits = await store.search!(CORPUS, [1, 0], { k: 2 });
    expect(hits.map((h) => h.entry.id)).toEqual(['alpha', 'zebra']);
  });

  it('an unnamed embedder never blocks a compatible write — most callers never pass one', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0])); // no embeddingModel
    await store.put(CORPUS, entry('b', [0, 1], { embeddingModel: 'named' } as never));
    await expect(store.search!(CORPUS, [1, 0])).resolves.toHaveLength(2);
  });

  it('every namespace is independent — vectors, signatures, feedback and fingerprint', async () => {
    const store = open();
    const acme: MemoryIdentity = { tenant: 'acme', conversationId: 'c' };
    const beta: MemoryIdentity = { tenant: 'beta', conversationId: 'c' };
    await store.put(acme, entry('a', [1, 0], { embeddingModel: 'x' } as never));
    await store.put(beta, entry('b', [1, 0, 0], { embeddingModel: 'y' } as never));
    await store.recordSignature(acme, 'sig');

    expect((await store.search!(acme, [1, 0])).map((h) => h.entry.id)).toEqual(['a']);
    expect((await store.search!(beta, [1, 0, 0])).map((h) => h.entry.id)).toEqual(['b']);
    expect(await store.seen(beta, 'sig')).toBe(false);
    // Different dimensions in two namespaces is fine; only WITHIN one is it a lie.
    expect(store.fingerprintOf(acme)).toBe('x@2');
    expect(store.fingerprintOf(beta)).toBe('y@3');
  });
});

// ─── Security — isolation and untrusted content ────────────────────

describeWithSqlite('sqliteVectorStore — security', () => {
  it('one tenant cannot read, search or delete another tenant', async () => {
    const store = open();
    const acme: MemoryIdentity = { tenant: 'acme', conversationId: 'c' };
    const beta: MemoryIdentity = { tenant: 'beta', conversationId: 'c' };
    await store.put(acme, entry('secret', [1, 0]));

    expect(await store.get(beta, 'secret')).toBeNull();
    expect(await store.search!(beta, [1, 0])).toEqual([]);
    await store.delete(beta, 'secret');
    expect(await store.get(acme, 'secret')).not.toBeNull();
    await store.forget(beta);
    expect(await store.get(acme, 'secret')).not.toBeNull();
  });

  it('an id built from SQL cannot escape a bound parameter', async () => {
    const store = open();
    const nasty = `x'; DROP TABLE af_vectors; --`;
    await store.put(CORPUS, entry(nasty, [1, 0]));
    expect((await store.get(CORPUS, nasty))?.id).toBe(nasty);
    // The table is still there, which it would not be if the id had been
    // interpolated rather than bound.
    expect((await store.list(CORPUS)).entries.length).toBe(1);
  });

  it('a namespace built from SQL cannot escape either', async () => {
    const store = open();
    const nasty: MemoryIdentity = { tenant: `'; DELETE FROM af_vectors; --`, conversationId: 'c' };
    await store.put(CORPUS, entry('safe', [1, 0]));
    await store.put(nasty, entry('other', [1, 0]));
    expect((await store.list(CORPUS)).entries.map((e) => e.id)).toEqual(['safe']);
  });

  it('a value that is not JSON-clean still round-trips through the store', async () => {
    const store = open();
    const weird = { text: 'quote " backslash \\ newline \n unicode ‍', nested: { a: [1, 2] } };
    await store.put(CORPUS, { ...entry('w', [1, 0]), value: weird } as never);
    expect((await store.get(CORPUS, 'w'))?.value).toEqual(weird);
  });
});

// ─── Refusal — file identity and embedder identity ─────────────────

describeWithSqlite('sqliteVectorStore — refusals against a real file', () => {
  it('refuses a file that is not a database, rather than treating it as empty', () => {
    const file = join(dir, 'notadb.db');
    writeFileSync(file, 'this is not a sqlite database, it is a text file');
    expect(() => sqliteVectorStore({ file })).toThrow(UnreadableIndexFileError);
    try {
      sqliteVectorStore({ file });
    } catch (err) {
      expect((err as UnreadableIndexFileError).problem).toBe('cannot-open');
      expect((err as Error).message).toContain('different facts');
    }
  });

  it("refuses somebody else's table of the same name", async () => {
    const file = join(dir, 'foreign.db');
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE af_vectors (id TEXT PRIMARY KEY, unrelated TEXT)');
    db.close();

    try {
      sqliteVectorStore({ file });
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(UnreadableIndexFileError);
      expect((err as UnreadableIndexFileError).problem).toBe('not-our-schema');
      expect((err as Error).message).toContain('file of its own');
    }
  });

  it('refuses an index written by a newer agentfootprint', async () => {
    const file = join(dir, 'newer.db');
    const store = sqliteVectorStore({ file });
    store.close();
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec(`UPDATE af_index_meta SET value = '99' WHERE key = 'schema_version'`);
    db.close();

    try {
      sqliteVectorStore({ file });
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(UnreadableIndexFileError);
      expect((err as UnreadableIndexFileError).problem).toBe('newer-schema');
      expect((err as Error).message).toContain('roll forward');
    }
  });

  it('FINGERPRINT: refuses a second embedder at WRITE, naming both', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0], { embeddingModel: 'static' } as never));
    expect(store.fingerprintOf(CORPUS)).toBe('static@2'); // '<id>@<dims>'

    try {
      await store.put(CORPUS, entry('b', [1, 0], { embeddingModel: 'openai' } as never));
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderMismatchError);
      expect((err as EmbedderMismatchError).indexed).toBe('static@2');
      expect((err as EmbedderMismatchError).incoming).toBe('openai@2');
      expect((err as EmbedderMismatchError).problem).toBe('model');
      expect((err as Error).message).toContain('write to');
      expect((err as Error).message).toContain('Re-index this namespace');
    }
    // And nothing landed.
    expect(await store.get(CORPUS, 'b')).toBeNull();
  });

  it('FINGERPRINT: refuses a swapped embedder at QUERY, before it can score', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0], { embeddingModel: 'static' } as never));
    try {
      await store.search!(CORPUS, [1, 0], { embedderId: 'openai' });
      expect.unreachable('should have refused');
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderMismatchError);
      expect((err as EmbedderMismatchError).problem).toBe('model');
      expect((err as Error).message).toContain('search');
      expect((err as Error).message).toContain('is not a signal');
    }
  });

  it('FINGERPRINT: refuses a dimension change on both sides', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0], { embeddingModel: 'e' } as never));
    await expect(
      store.put(CORPUS, entry('b', [1, 0, 0], { embeddingModel: 'e' } as never)),
    ).rejects.toThrow(/cannot be compared at all/);
    await expect(store.search!(CORPUS, [1, 0, 0])).rejects.toThrow(EmbedderMismatchError);
  });

  it('the named fix WORKS: forget the namespace, then re-index with the new embedder', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0], { embeddingModel: 'old' } as never));
    await expect(
      store.put(CORPUS, entry('b', [1, 0, 0], { embeddingModel: 'new' } as never)),
    ).rejects.toThrow(EmbedderMismatchError);

    // The refusal names re-indexing as the fix; it has to actually be one.
    await store.forget(CORPUS);
    await store.put(CORPUS, entry('b', [1, 0, 0], { embeddingModel: 'new' } as never));
    expect(store.fingerprintOf(CORPUS)).toBe('new@3');
    expect((await store.search!(CORPUS, [1, 0, 0])).map((h) => h.entry.id)).toEqual(['b']);
  });

  it('a closed store refuses by name rather than reopening behind you', async () => {
    const store = open();
    await store.put(CORPUS, entry('a', [1, 0]));
    store.close();
    store.close(); // idempotent
    await expect(store.get(CORPUS, 'a')).rejects.toThrow(/is closed/);
    await expect(store.search!(CORPUS, [1, 0])).rejects.toThrow(/is closed/);
  });
});

// ─── Integration — with the real RAG path ──────────────────────────

describeWithSqlite('sqliteVectorStore — integration', () => {
  it('the whole RAG path runs on it, and the corpus outlives the process', async () => {
    const { Agent, defineRAG, indexDocuments } = await import('../../src/index.js');
    const { mock } = await import('../../src/llm-providers.js');
    const file = join(dir, 'rag.db');
    const embedder = mockEmbedder();

    const seed = sqliteVectorStore({ file });
    const indexed = await indexDocuments(
      seed,
      embedder,
      [
        { id: 'refunds.md#0', content: 'Refunds are processed within 3 business days.' },
        { id: 'pricing.md#0', content: 'The Pro plan costs $20 per month.' },
      ],
      { embedderId: embedder.id },
    );
    expect(indexed).toBe(2);
    // indexDocuments defaults embedderId to the embedder's own id (8.9.0), so
    // the namespace is fingerprinted even when the caller passes nothing.
    expect(seed.fingerprintOf(CORPUS)).toBe(`${embedder.id}@${embedder.dimensions}`);
    seed.close();

    // A different process would open a different store object over the file.
    const store = sqliteVectorStore({ file });
    opened.push(store);
    const agent = Agent.create({ provider: mock({ reply: 'Three business days.' }), model: 'mock' })
      .rag(defineRAG({ id: 'docs', store, embedder, embedderId: embedder.id, threshold: 0.5 }))
      .build();

    const events: { type: string; payload: Record<string, unknown> }[] = [];
    agent.on('*', (e) => events.push(e as never));
    const answer = await agent.run({ message: 'How long do refunds take?' });

    expect(answer).toBe('Three business days.');
    const retrieved = events.filter((e) => e.type === 'agentfootprint.memory.retrieved');
    expect(retrieved.length).toBe(1);
    expect(retrieved[0]!.payload['admittedCount']).toBeGreaterThan(0);
  });

  it('embedding.generated reaches agent.on — index-time and query-time are separable', async () => {
    const { Agent, defineRAG } = await import('../../src/index.js');
    const { mock } = await import('../../src/llm-providers.js');
    const { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } = await import(
      '../../src/memory/index.js'
    );
    const embedder = mockEmbedder();
    const corpus = open('corpus.db');
    const chat = open('chat.db');

    await corpus.put(CORPUS, {
      ...entry('a', await embedder.embed({ text: 'Refunds take 3 business days.' })),
      embeddingModel: embedder.id,
    } as never);

    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .rag(
        defineRAG({ id: 'docs', store: corpus, embedder, embedderId: embedder.id, threshold: -1 }),
      )
      // A conversation memory writes, so the DOCUMENT side fires too.
      .memory(
        defineMemory({
          id: 'chat',
          type: MEMORY_TYPES.SEMANTIC,
          strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, threshold: -1, embedder },
          store: chat,
        }),
      )
      .build();

    const embeds: Record<string, unknown>[] = [];
    agent.on('agentfootprint.embedding.generated', (e) => embeds.push(e.payload as never));
    await agent.run({ message: 'How long do refunds take?', identity: { conversationId: 'c1' } });

    const kinds = embeds.map((p) => p['inputKind']);
    expect(kinds).toContain('query');
    expect(kinds).toContain('document');
    for (const payload of embeds) {
      expect(typeof payload['durationMs']).toBe('number');
      expect(payload['dimension']).toBe(embedder.dimensions);
    }
  });

  it('indexDocuments reports its cost through onEmbedding — a boot script has no emit channel', async () => {
    const { indexDocuments } = await import('../../src/index.js');
    const store = open();
    const seen: Record<string, unknown>[] = [];
    await indexDocuments(
      store,
      mockEmbedder(),
      [
        { id: 'a', content: 'one' },
        { id: 'b', content: 'two' },
      ],
      { onEmbedding: (p) => seen.push(p as never) },
    );
    expect(seen.length).toBe(1);
    expect(seen[0]!['inputKind']).toBe('document');
    expect(seen[0]!['count']).toBe(2);
  });
});
