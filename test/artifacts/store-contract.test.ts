/**
 * The ArtifactStore contract, run against the three LOCAL adapters — one law,
 * three storage mechanics. Then each adapter's OWN laws: the in-memory store's
 * bounds + drop counting, the file store's traversal-proof paths and
 * present-but-unreadable refusal, the sqlite store's file refusals.
 *
 * The contract suite itself lives in `./storeContractSuite.ts`, because the two
 * CLOUD adapters run THE SAME definition (`./cloud-stores.test.ts`) rather than
 * a copy of it — five adapters, one law, and a new law added there is one all
 * five must immediately satisfy.
 *
 * Sections follow Convention 3: Unit (naming / retention / payload laws) ·
 * Functional (the five-verb contract × 3) · Integration (adapter-specific
 * laws) · Regression (pins on the exact refusal classes).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ArtifactIntegrityError,
  fileArtifacts,
  inMemoryArtifacts,
  InvalidArtifactError,
  isArtifactRef,
  mintArtifactRef,
  sqliteArtifacts,
  UnknownParentRefError,
  UnreadableArtifactFileError,
  UnreadableArtifactStoreError,
  type ArtifactScope,
  type ArtifactStore,
} from '../../src/index.js';
import { planRetention, resolveExpiresAt } from '../../src/artifacts/retention.js';
import {
  canonicalPayloadBytes,
  decodeArtifactData,
  encodeArtifactData,
  measureArtifactBytes,
} from '../../src/artifacts/payload.js';
import { clock, contractSuite, OTHER_SCOPE, SCOPE } from './storeContractSuite.js';

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

// Node 20 has no `node:sqlite`; the sqlite suites skip there (the adapter's
// own SqliteUnavailableError refusal is pinned by the sessions suite for the
// same shared class).
const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();
const onSqlite = describe.skipIf(!sqliteAvailable);

/** A raw connection, for writing the damage a store must refuse to read. */
async function rawDatabase(file: string): Promise<{ exec(sql: string): void; close(): void }> {
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
  };
  return new DatabaseSync(file);
}

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afp-artifacts-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// Scope tuples, the controllable clock and the contract suite itself are
// shared with the cloud adapters' file — one definition, every adapter.

// ─────────────────────────────────────────────────────────────────────────
// Unit — the one-owner laws
// ─────────────────────────────────────────────────────────────────────────

describe('naming — the ref grammar has one owner', () => {
  it('mints art_ + 22 base62 chars (26 total), unique, recognized by isArtifactRef', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const ref = mintArtifactRef();
      expect(ref).toMatch(/^art_[A-Za-z0-9]{22}$/);
      expect(ref).toHaveLength(26);
      expect(isArtifactRef(ref)).toBe(true);
      seen.add(ref);
    }
    expect(seen.size).toBe(200); // never content-derived, never repeated
  });

  it('rejects everything that is not a minted ref, totally', () => {
    for (const bad of ['', 'art_short', 'art_' + 'x'.repeat(23), '../etc/passwd', 42, null]) {
      expect(isArtifactRef(bad)).toBe(false);
    }
  });
});

describe('retention — the pure eviction law', () => {
  it('sweeps ttl first, then count, then bytes — least-recently-accessed leaves first', () => {
    const rows = [
      { ref: 'art_' + 'a'.repeat(22), kind: 'k', bytes: 10, expiresAt: 50, lastAccessedAt: 1 },
      { ref: 'art_' + 'b'.repeat(22), kind: 'k', bytes: 10, lastAccessedAt: 2 },
      { ref: 'art_' + 'c'.repeat(22), kind: 'k', bytes: 10, lastAccessedAt: 3 },
    ];
    const plan = planRetention(rows, 10, { maxBytesPerScope: 25, maxCountPerScope: 10 }, 100);
    expect(plan.refusal).toBeUndefined();
    expect(plan.swept.map((s) => s.reason)).toEqual(['ttl', 'max-bytes']);
    expect(plan.swept[1].ref).toBe('art_' + 'b'.repeat(22)); // LRU, not newest
  });

  it('refuses a payload larger than the whole byte budget instead of emptying the scope', () => {
    const plan = planRetention([], 1000, { maxBytesPerScope: 100 }, 0);
    expect(plan.refusal).toContain('byte budget');
  });

  it('expiresAt: the store may TIGHTEN a caller promise, never extend it', () => {
    expect(resolveExpiresAt(500, { ttlMs: 1000 }, 0)).toBe(500);
    expect(resolveExpiresAt(5000, { ttlMs: 1000 }, 0)).toBe(1000);
    expect(resolveExpiresAt(undefined, { ttlMs: 1000 }, 0)).toBe(1000);
    expect(resolveExpiresAt(undefined, undefined, 0)).toBeUndefined();
  });
});

describe('payload — measured, carried, and refused one way', () => {
  it('measures utf-8 for text/JSON and byteLength for binary', () => {
    expect(measureArtifactBytes('abc')).toBe(3);
    expect(measureArtifactBytes('é')).toBe(2);
    expect(measureArtifactBytes(new Uint8Array([1, 2, 3, 4]))).toBe(4);
    expect(measureArtifactBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it('refuses what JSON cannot carry, by name', () => {
    expect(() => canonicalPayloadBytes(() => 1)).toThrow(InvalidArtifactError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalPayloadBytes(cyclic)).toThrow(InvalidArtifactError);
  });

  it('the durable envelope round-trips all three shapes byte-for-byte', () => {
    const bin = new Uint8Array([0, 255, 128, 7]);
    expect(decodeArtifactData(encodeArtifactData('plain'))).toBe('plain');
    expect(decodeArtifactData(encodeArtifactData({ rows: [1, 2] }))).toEqual({ rows: [1, 2] });
    expect(decodeArtifactData(encodeArtifactData(bin))).toEqual(bin);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — the five-verb contract, once per adapter
//
// The suite itself lives in `./storeContractSuite.ts` so the two CLOUD
// adapters run THE SAME laws rather than a copy of them (see that file's
// header). A law added there is a law all five adapters must satisfy.
// ─────────────────────────────────────────────────────────────────────────

contractSuite('inMemoryArtifacts', (now) => inMemoryArtifacts({ _now: now }));
contractSuite('fileArtifacts', (now) => fileArtifacts({ directory: tempDir(), _now: now }));
contractSuite(
  'sqliteArtifacts',
  (now) => sqliteArtifacts({ file: join(tempDir(), 'artifacts.db'), _now: now }),
  onSqlite,
);

// ─────────────────────────────────────────────────────────────────────────
// Integration — each adapter's own laws
// ─────────────────────────────────────────────────────────────────────────

describe('inMemoryArtifacts — bounded and counting its drops', () => {
  it('is ALWAYS bounded: the default dials exist without any configuration', () => {
    const store = inMemoryArtifacts();
    expect(store.retention.maxBytesPerScope).toBe(32 * 1024 * 1024);
    expect(store.retention.maxCountPerScope).toBe(256);
  });

  it('evicts least-recently-USED over the count budget, reports the sweep, and COUNTS it', async () => {
    const time = clock();
    const store = inMemoryArtifacts({ retention: { maxCountPerScope: 2 }, _now: time.now });
    const a = (await store.put(SCOPE, { kind: 'a', mediaType: 't', data: '1' })).meta;
    time.tick(10);
    const b = (await store.put(SCOPE, { kind: 'b', mediaType: 't', data: '2' })).meta;
    time.tick(10);
    // touch a so b becomes the least-recently-used
    await store.get(SCOPE, a.ref);
    time.tick(10);
    const third = await store.put(SCOPE, { kind: 'c', mediaType: 't', data: '3' });
    expect(third.swept).toEqual([{ ref: b.ref, reason: 'max-count', kind: 'b', bytes: 1 }]);
    expect(store.dropped).toBe(1);
    expect(await store.get(SCOPE, b.ref)).toBeNull();
    expect(await store.get(SCOPE, a.ref)).not.toBeNull(); // the read spared it
  });

  it('ttl sweeps are the calendar, not pressure — they do not count as drops', async () => {
    const time = clock();
    const store = inMemoryArtifacts({ retention: { ttlMs: 100 }, _now: time.now });
    const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
    expect(meta.expiresAt).toBe(time.now() + 100); // stamped from ttl — stated at mint
    time.tick(200);
    const second = await store.put(SCOPE, { kind: 'k2', mediaType: 't', data: 'y' });
    expect(second.swept).toEqual([{ ref: meta.ref, reason: 'ttl', kind: 'k', bytes: 1 }]);
    expect(store.dropped).toBe(0);
  });

  it('a byte budget evicts to fit and refuses the unfittable', async () => {
    const time = clock();
    const store = inMemoryArtifacts({ retention: { maxBytesPerScope: 10 }, _now: time.now });
    await store.put(SCOPE, { kind: 'a', mediaType: 't', data: '123456' });
    const second = await store.put(SCOPE, { kind: 'b', mediaType: 't', data: '789012' });
    expect(second.swept.map((s) => s.reason)).toEqual(['max-bytes']);
    expect(store.dropped).toBe(1);
    await expect(
      store.put(SCOPE, { kind: 'c', mediaType: 't', data: 'x'.repeat(11) }),
    ).rejects.toThrow(InvalidArtifactError);
  });

  it('refuses retention dials that cannot bind, at construction', () => {
    expect(() => inMemoryArtifacts({ retention: { maxCountPerScope: 0 } })).toThrow(TypeError);
    expect(() => inMemoryArtifacts({ retention: { ttlMs: -5 } })).toThrow(TypeError);
  });
});

describe('fileArtifacts — a directory a human can read, and nothing more', () => {
  it('partitions scopes into percent-encoded directories — traversal arrives as data', async () => {
    const dir = tempDir();
    const time = clock();
    const store = fileArtifacts({ directory: dir, _now: time.now });
    const hostile: ArtifactScope = {
      tenant: '../../escape',
      principal: 'p/../p2',
      conversationId: 'c',
    };
    const { meta } = await store.put(hostile, { kind: 'k', mediaType: 't', data: 'x' });
    expect(await store.get(hostile, meta.ref)).not.toBeNull();
    // nothing escaped the root: the hostile tenant exists AS ONE NAME inside
    // it, dots and slashes encoded to inert bytes ('%2E%2E%2F%2E%2E%2Fescape')
    const names = readdirSync(dir);
    expect(names).toHaveLength(1);
    expect(names[0]).toBe(encodeURIComponent('../../escape').replace(/\./g, '%2E'));
    // and a literal '..' tenant is a NAME too, not a hop
    const dotdot: ArtifactScope = { tenant: '..', principal: 'p', conversationId: 'c' };
    const second = await store.put(dotdot, { kind: 'k', mediaType: 't', data: 'y' });
    expect(await store.get(dotdot, second.meta.ref)).not.toBeNull();
    expect(readdirSync(dir)).toContain('%2E%2E');
  });

  it('a file that exists but is not an envelope is refused BY NAME, never read as absent', async () => {
    const dir = tempDir();
    const store = fileArtifacts({ directory: dir });
    const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
    // corrupt the exact file the ref names
    const scopeDir = join(dir, '_', '_', 'conv-a');
    writeFileSync(join(scopeDir, `${meta.ref}.json`), 'not json at all');
    await expect(store.get(SCOPE, meta.ref)).rejects.toThrow(UnreadableArtifactFileError);
  });

  it('detects digest mismatch when bytes changed on disk — teaching refusal, never silent corruption', async () => {
    const dir = tempDir();
    const store = fileArtifacts({ directory: dir });
    const { meta } = await store.put(SCOPE, {
      kind: 'k',
      mediaType: 'text/plain',
      data: 'true bytes',
      digest: 'sha-256',
    });
    const file = join(dir, '_', '_', 'conv-a', `${meta.ref}.json`);
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    (envelope.payload as { value: string }).value = 'tampered bytes';
    writeFileSync(file, JSON.stringify(envelope));
    await expect(store.get(SCOPE, meta.ref)).rejects.toThrow(ArtifactIntegrityError);
    // the meta is still readable — the ticket survives its parcel
    expect(await store.head(SCOPE, meta.ref)).not.toBeNull();
  });

  it('refuses a blank directory at construction', () => {
    expect(() => fileArtifacts({ directory: '  ' })).toThrow(TypeError);
  });
});

describe("sqliteArtifacts — ':memory:' refusal (runs on every Node)", () => {
  it("refuses ':memory:' — inMemoryArtifacts says that in its name", () => {
    expect(() => sqliteArtifacts({ file: ':memory:' })).toThrow(/inMemoryArtifacts/);
  });
});

onSqlite('sqliteArtifacts — the sessions laws, per store', () => {
  it('reports the journal mode it actually got and survives reopen (durability)', async () => {
    const file = join(tempDir(), 'artifacts.db');
    const store = sqliteArtifacts({ file });
    expect(typeof store.journalMode).toBe('string');
    const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'kept' });
    store.close();
    const reopened = sqliteArtifacts({ file });
    const got = await reopened.get(SCOPE, meta.ref);
    expect(got?.data).toBe('kept');
    reopened.close();
  });

  it('close() is final — later verbs refuse by name instead of reopening', async () => {
    const store = sqliteArtifacts({ file: join(tempDir(), 'a.db') });
    store.close();
    store.close(); // idempotent
    await expect(store.list(SCOPE)).rejects.toThrow(/closed/);
  });

  it('a file that is not a database is refused as cannot-open, never as empty', () => {
    const file = join(tempDir(), 'not-a-db.db');
    writeFileSync(file, 'plain text pretending to be a database, long enough to have a header');
    expect(() => sqliteArtifacts({ file })).toThrow(UnreadableArtifactStoreError);
  });

  it("somebody else's af_artifacts table is refused as not-our-schema", async () => {
    const file = join(tempDir(), 'foreign.db');
    const raw = await rawDatabase(file);
    raw.exec('CREATE TABLE af_artifacts (id INTEGER PRIMARY KEY, junk TEXT)');
    raw.close();
    let thrown: unknown;
    try {
      sqliteArtifacts({ file });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnreadableArtifactStoreError);
    expect((thrown as UnreadableArtifactStoreError).problem).toBe('not-our-schema');
  });

  it('a newer schema version is refused, never half-read', async () => {
    const file = join(tempDir(), 'newer.db');
    const store = sqliteArtifacts({ file });
    store.close();
    const raw = await rawDatabase(file);
    raw.exec("UPDATE af_artifacts_meta SET value = '999' WHERE key = 'schema_version'");
    raw.close();
    let thrown: unknown;
    try {
      sqliteArtifacts({ file });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnreadableArtifactStoreError);
    expect((thrown as UnreadableArtifactStoreError).problem).toBe('newer-schema');
  });

  it('budget evictions are least-recently-ACCESSED — reads refresh recency', async () => {
    const time = clock();
    const store = sqliteArtifacts({
      file: join(tempDir(), 'lru.db'),
      retention: { maxCountPerScope: 2 },
      _now: time.now,
    });
    const a = (await store.put(SCOPE, { kind: 'a', mediaType: 't', data: '1' })).meta;
    time.tick(10);
    const b = (await store.put(SCOPE, { kind: 'b', mediaType: 't', data: '2' })).meta;
    time.tick(10);
    await store.head(SCOPE, a.ref); // spare a
    time.tick(10);
    const third = await store.put(SCOPE, { kind: 'c', mediaType: 't', data: '3' });
    expect(third.swept.map((s) => s.ref)).toEqual([b.ref]);
    expect(await store.head(SCOPE, a.ref)).not.toBeNull();
    store.close();
  });
});
