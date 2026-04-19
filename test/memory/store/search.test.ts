/**
 * InMemoryStore.search() — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     k=1 returns the single closest entry; descending score order
 *   - boundary: no embedded entries → empty; empty query + edge cases
 *   - scenario: realistic "dogs" query retrieves dog beats over car beats
 *   - property: tenant isolation; entries without embedding skipped silently;
 *               descending score ordering; deterministic tie-break
 *   - security: length-mismatched entries skipped (no poison); TTL-expired
 *               entries excluded; cross-embedder filter works
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '../../../src/memory/store';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { MemoryIdentity } from '../../../src/memory/identity';
import { mockEmbedder } from '../../../src/memory/embedding';

const ID_A: MemoryIdentity = { tenant: 't1', conversationId: 'c1' };
const ID_B: MemoryIdentity = { tenant: 't2', conversationId: 'c1' };

function makeEntry(id: string, overrides?: Partial<MemoryEntry>): MemoryEntry {
  const now = Date.now();
  return {
    id,
    value: `value-${id}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...overrides,
  };
}

let store: InMemoryStore;
const embedder = mockEmbedder({ dimensions: 32 });

beforeEach(() => {
  store = new InMemoryStore();
});

// ── Unit ────────────────────────────────────────────────────

describe('search — unit', () => {
  it('k=1 returns the single highest-scoring entry', async () => {
    const queryVec = await embedder.embed({ text: 'dogs are great' });
    await store.put(ID_A, makeEntry('match', { embedding: queryVec }));
    await store.put(
      ID_A,
      makeEntry('other', { embedding: await embedder.embed({ text: 'zzzzzzz' }) }),
    );
    const results = await store.search!(ID_A, queryVec, { k: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].entry.id).toBe('match');
    expect(results[0].score).toBeCloseTo(1, 3);
  });

  it('returns results in descending score order', async () => {
    const queryVec = await embedder.embed({ text: 'the quick brown fox' });
    await store.put(ID_A, makeEntry('closest', { embedding: queryVec }));
    await store.put(
      ID_A,
      makeEntry('medium', {
        embedding: await embedder.embed({ text: 'a different text' }),
      }),
    );
    await store.put(
      ID_A,
      makeEntry('farthest', {
        embedding: await embedder.embed({ text: 'xyzxyzxyz' }),
      }),
    );
    const results = await store.search!(ID_A, queryVec, { k: 10 });
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('search — boundary', () => {
  it('empty store → empty results', async () => {
    const vec = await embedder.embed({ text: 'anything' });
    const results = await store.search!(ID_A, vec, { k: 10 });
    expect(results).toEqual([]);
  });

  it('entries without embedding are silently skipped', async () => {
    await store.put(ID_A, makeEntry('no-vec'));
    await store.put(
      ID_A,
      makeEntry('with-vec', {
        embedding: await embedder.embed({ text: 'hello' }),
      }),
    );
    const vec = await embedder.embed({ text: 'hello' });
    const results = await store.search!(ID_A, vec);
    expect(results.map((r) => r.entry.id)).toEqual(['with-vec']);
  });

  it('k larger than available entries returns all available', async () => {
    await store.put(ID_A, makeEntry('a', { embedding: await embedder.embed({ text: 'a' }) }));
    await store.put(ID_A, makeEntry('b', { embedding: await embedder.embed({ text: 'b' }) }));
    const results = await store.search!(ID_A, await embedder.embed({ text: 'x' }), { k: 100 });
    expect(results).toHaveLength(2);
  });

  it('default k is 10', async () => {
    for (let i = 0; i < 15; i++) {
      await store.put(
        ID_A,
        makeEntry(`k${i}`, { embedding: await embedder.embed({ text: `text-${i}` }) }),
      );
    }
    const results = await store.search!(ID_A, await embedder.embed({ text: 'query' }));
    expect(results).toHaveLength(10);
  });

  it('minScore filter drops sub-threshold matches', async () => {
    await store.put(
      ID_A,
      makeEntry('close', { embedding: await embedder.embed({ text: 'hello world' }) }),
    );
    await store.put(ID_A, makeEntry('far', { embedding: await embedder.embed({ text: '12345' }) }));
    const results = await store.search!(ID_A, await embedder.embed({ text: 'hello world' }), {
      minScore: 0.99,
    });
    expect(results.map((r) => r.entry.id)).toContain('close');
    expect(results.map((r) => r.entry.id)).not.toContain('far');
  });

  it('tier filter includes only matching tiers', async () => {
    await store.put(
      ID_A,
      makeEntry('h1', {
        tier: 'hot',
        embedding: await embedder.embed({ text: 'a' }),
      }),
    );
    await store.put(
      ID_A,
      makeEntry('c1', {
        tier: 'cold',
        embedding: await embedder.embed({ text: 'a' }),
      }),
    );
    const results = await store.search!(ID_A, await embedder.embed({ text: 'a' }), {
      tiers: ['hot'],
    });
    expect(results.map((r) => r.entry.id)).toEqual(['h1']);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('search — scenario', () => {
  it('realistic recall — "dogs are wonderful pets" retrieves dog beats over car beats', async () => {
    // Index three beats
    const beats = [
      { id: 'dog1', text: 'I have two dogs and they are wonderful' },
      { id: 'dog2', text: 'dogs make great pets' },
      { id: 'car1', text: 'my car is a fast sports vehicle' },
    ];
    for (const b of beats) {
      await store.put(ID_A, makeEntry(b.id, { embedding: await embedder.embed({ text: b.text }) }));
    }
    const queryVec = await embedder.embed({ text: 'dogs are wonderful pets' });
    const results = await store.search!(ID_A, queryVec, { k: 2 });
    expect(results.length).toBe(2);
    // Both dog beats should outrank the car beat
    const topIds = results.map((r) => r.entry.id);
    expect(topIds).not.toContain('car1');
  });
});

// ── Property ────────────────────────────────────────────────

describe('search — property', () => {
  it('tenant isolation — tenant A results never include tenant B entries', async () => {
    await store.put(
      ID_A,
      makeEntry('a-item', {
        value: 'tenant-A-secret',
        embedding: await embedder.embed({ text: 'secret' }),
      }),
    );
    await store.put(
      ID_B,
      makeEntry('b-item', {
        value: 'tenant-B-secret',
        embedding: await embedder.embed({ text: 'secret' }),
      }),
    );
    const queryVec = await embedder.embed({ text: 'secret' });
    const resultsA = await store.search!(ID_A, queryVec);
    const resultsB = await store.search!(ID_B, queryVec);
    expect(resultsA.map((r) => r.entry.id)).toEqual(['a-item']);
    expect(resultsB.map((r) => r.entry.id)).toEqual(['b-item']);
  });

  it('deterministic tie-break — equal scores sort by id ascending', async () => {
    // Two entries with IDENTICAL embeddings → same cosine score.
    const vec = await embedder.embed({ text: 'same' });
    await store.put(ID_A, makeEntry('zebra', { embedding: vec }));
    await store.put(ID_A, makeEntry('alpha', { embedding: vec }));
    const results = await store.search!(ID_A, vec);
    expect(results.map((r) => r.entry.id)).toEqual(['alpha', 'zebra']);
  });

  it('every returned score is in [-1, 1]', async () => {
    for (let i = 0; i < 10; i++) {
      await store.put(
        ID_A,
        makeEntry(`e${i}`, { embedding: await embedder.embed({ text: `text ${i}` }) }),
      );
    }
    const results = await store.search!(ID_A, await embedder.embed({ text: 'q' }), { k: 10 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('search — security', () => {
  it('length-mismatched embeddings are skipped (no cosine throw poisoning the top-k)', async () => {
    await store.put(
      ID_A,
      makeEntry('good', { embedding: await embedder.embed({ text: 'hello' }) }),
    );
    // Manually write an entry with a BROKEN embedding length
    await store.put(ID_A, makeEntry('bad', { embedding: [1, 2, 3] }));
    const results = await store.search!(ID_A, await embedder.embed({ text: 'hello' }));
    expect(results.map((r) => r.entry.id)).toEqual(['good']);
  });

  it('TTL-expired entries are excluded from results', async () => {
    const long = await embedder.embed({ text: 'active' });
    const expired = await embedder.embed({ text: 'active' });
    await store.put(ID_A, makeEntry('alive', { embedding: long, ttl: Date.now() + 60_000 }));
    await store.put(ID_A, makeEntry('dead', { embedding: expired, ttl: Date.now() - 1000 }));
    const results = await store.search!(ID_A, long);
    expect(results.map((r) => r.entry.id)).toEqual(['alive']);
  });

  it('embedderId filter excludes entries from a different embedder', async () => {
    await store.put(
      ID_A,
      makeEntry('openai', {
        embedding: await embedder.embed({ text: 'hi' }),
        embeddingModel: 'openai-text-embedding-3-small',
      }),
    );
    await store.put(
      ID_A,
      makeEntry('voyage', {
        embedding: await embedder.embed({ text: 'hi' }),
        embeddingModel: 'voyage-2',
      }),
    );
    const queryVec = await embedder.embed({ text: 'hi' });
    const results = await store.search!(ID_A, queryVec, {
      embedderId: 'openai-text-embedding-3-small',
    });
    expect(results.map((r) => r.entry.id)).toEqual(['openai']);
  });
});
