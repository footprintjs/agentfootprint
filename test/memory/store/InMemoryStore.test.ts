/**
 * InMemoryStore — 5-pattern tests.
 *
 * Validates every method of the MemoryStore contract. These tests double
 * as the specification — any alternative adapter (Redis, DynamoDB,
 * Postgres, AgentCore) should be able to run this exact test file
 * against its implementation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '../../../src/memory/store/InMemoryStore';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { MemoryIdentity } from '../../../src/memory/identity';

const ID_A: MemoryIdentity = { tenant: 't1', principal: 'u1', conversationId: 'c1' };
const ID_B: MemoryIdentity = { tenant: 't1', principal: 'u2', conversationId: 'c1' };
const ID_TENANT2: MemoryIdentity = { tenant: 't2', principal: 'u1', conversationId: 'c1' };

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
beforeEach(() => {
  store = new InMemoryStore();
});

// ── Unit ────────────────────────────────────────────────────

describe('InMemoryStore — unit', () => {
  it('get returns null for missing entries', async () => {
    expect(await store.get(ID_A, 'nope')).toBeNull();
  });

  it('put then get roundtrips the stored value', async () => {
    await store.put(ID_A, makeEntry('k1'));
    const got = await store.get(ID_A, 'k1');
    expect(got?.id).toBe('k1');
    expect(got?.value).toBe('value-k1');
  });

  it('get increments accessCount and updates lastAccessedAt', async () => {
    const before = Date.now() - 1000;
    await store.put(ID_A, makeEntry('k1', { accessCount: 0, lastAccessedAt: before }));
    const got = await store.get(ID_A, 'k1');
    expect(got?.accessCount).toBe(1);
    expect(got?.lastAccessedAt).toBeGreaterThanOrEqual(before + 1);
  });

  it('put overwrites existing entry with same id', async () => {
    await store.put(ID_A, makeEntry('k1', { value: 'v1', version: 1 }));
    await store.put(ID_A, makeEntry('k1', { value: 'v2', version: 2 }));
    const got = await store.get(ID_A, 'k1');
    expect(got?.value).toBe('v2');
    expect(got?.version).toBe(2);
  });

  it('delete removes the entry', async () => {
    await store.put(ID_A, makeEntry('k1'));
    await store.delete(ID_A, 'k1');
    expect(await store.get(ID_A, 'k1')).toBeNull();
  });

  it('delete is a no-op for missing entries', async () => {
    await expect(store.delete(ID_A, 'nope')).resolves.toBeUndefined();
  });
});

// ── Boundary — TTL, pagination, versioning ─────────────────

describe('InMemoryStore — boundary', () => {
  it('TTL-expired entry is not returned by get, and is evicted lazily', async () => {
    await store.put(ID_A, makeEntry('k1', { ttl: Date.now() - 1 })); // already expired
    expect(await store.get(ID_A, 'k1')).toBeNull();
    // A subsequent put works normally (eviction removed it from the map)
    await store.put(ID_A, makeEntry('k1', { value: 'fresh' }));
    expect((await store.get(ID_A, 'k1'))?.value).toBe('fresh');
  });

  it('TTL-expired entries are excluded from list', async () => {
    await store.put(ID_A, makeEntry('live', { ttl: Date.now() + 10_000 }));
    await store.put(ID_A, makeEntry('dead', { ttl: Date.now() - 1 }));
    const { entries } = await store.list(ID_A);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain('live');
    expect(ids).not.toContain('dead');
  });

  it('list paginates via cursor', async () => {
    for (let i = 0; i < 5; i++) await store.put(ID_A, makeEntry(`k${i}`));
    const page1 = await store.list(ID_A, { limit: 2 });
    expect(page1.entries.length).toBe(2);
    expect(page1.cursor).toBeDefined();
    const page2 = await store.list(ID_A, { limit: 2, cursor: page1.cursor });
    expect(page2.entries.length).toBe(2);
    const page3 = await store.list(ID_A, { limit: 2, cursor: page2.cursor });
    expect(page3.entries.length).toBe(1);
    expect(page3.cursor).toBeUndefined();
  });

  it('list caps limit at MAX_LIST_LIMIT', async () => {
    // Request 10_000 but store only has 3 — just verifies we don't crash
    // and the result size is bounded by the data, not the request.
    for (let i = 0; i < 3; i++) await store.put(ID_A, makeEntry(`k${i}`));
    const page = await store.list(ID_A, { limit: 10_000 });
    expect(page.entries.length).toBe(3);
  });

  it('list filters by tier when requested', async () => {
    await store.put(ID_A, makeEntry('hot1', { tier: 'hot' }));
    await store.put(ID_A, makeEntry('warm1', { tier: 'warm' }));
    await store.put(ID_A, makeEntry('cold1', { tier: 'cold' }));
    await store.put(ID_A, makeEntry('untiered'));

    const hot = await store.list(ID_A, { tiers: ['hot'] });
    expect(hot.entries.map((e) => e.id)).toEqual(['hot1']);
    const hotWarm = await store.list(ID_A, { tiers: ['hot', 'warm'] });
    expect(hotWarm.entries.map((e) => e.id).sort()).toEqual(['hot1', 'warm1']);
  });

  it('putIfVersion: first-write path uses expectedVersion=0', async () => {
    const r = await store.putIfVersion(ID_A, makeEntry('k1'), 0);
    expect(r.applied).toBe(true);
  });

  it('putIfVersion: first-write with non-zero expected fails', async () => {
    const r = await store.putIfVersion(ID_A, makeEntry('k1'), 5);
    expect(r.applied).toBe(false);
  });

  it('putIfVersion: matching version wins, stale loses', async () => {
    await store.put(ID_A, makeEntry('k1', { version: 3 }));
    const stale = await store.putIfVersion(ID_A, makeEntry('k1', { version: 4 }), 2);
    expect(stale.applied).toBe(false);
    expect(stale.currentVersion).toBe(3);
    const ok = await store.putIfVersion(ID_A, makeEntry('k1', { version: 4 }), 3);
    expect(ok.applied).toBe(true);
  });

  it('invalid cursor falls back to offset 0 (no crash)', async () => {
    for (let i = 0; i < 3; i++) await store.put(ID_A, makeEntry(`k${i}`));
    const { entries } = await store.list(ID_A, { cursor: 'not-a-number' });
    expect(entries.length).toBe(3);
  });

  it('ttl === 0 is treated as expired (consistent with "past" semantics)', async () => {
    // Pins the contract: ttl = absolute unix-ms expiry. 0 is "1970-01-01"
    // which is in the past → expired. Consumers who want "no TTL" must
    // omit the field, NOT pass 0.
    await store.put(ID_A, makeEntry('k', { ttl: 0 }));
    expect(await store.get(ID_A, 'k')).toBeNull();
  });

  it('feedback rejects non-finite values (NaN / Infinity)', async () => {
    // DS-reviewer: a single NaN entering the aggregate permanently poisons
    // the running mean.
    await store.put(ID_A, makeEntry('k'));
    await store.feedback(ID_A, 'k', Number.NaN);
    await store.feedback(ID_A, 'k', Number.POSITIVE_INFINITY);
    expect(await store.getFeedback(ID_A, 'k')).toBeNull(); // no valid feedback recorded
    await store.feedback(ID_A, 'k', 0.5);
    const f = await store.getFeedback(ID_A, 'k');
    expect(f?.average).toBeCloseTo(0.5, 6);
    expect(f?.count).toBe(1);
  });

  it('delete then recreate with putIfVersion(0) succeeds', async () => {
    // DS-reviewer: after deletion, the id has no "current version" — a new
    // writer can treat it as "never existed." Pin that behavior.
    await store.put(ID_A, makeEntry('k', { version: 5 }));
    await store.delete(ID_A, 'k');
    const r = await store.putIfVersion(ID_A, makeEntry('k', { version: 1 }), 0);
    expect(r.applied).toBe(true);
    expect((await store.get(ID_A, 'k'))?.version).toBe(1);
  });
});

// ── Scenario — multi-tenant + multi-session isolation ───────

describe('InMemoryStore — scenario', () => {
  it('namespace isolation — writes to one identity are invisible to others', async () => {
    await store.put(ID_A, makeEntry('shared', { value: 'A-data' }));
    await store.put(ID_B, makeEntry('shared', { value: 'B-data' }));
    await store.put(ID_TENANT2, makeEntry('shared', { value: 'tenant2-data' }));

    expect((await store.get(ID_A, 'shared'))?.value).toBe('A-data');
    expect((await store.get(ID_B, 'shared'))?.value).toBe('B-data');
    expect((await store.get(ID_TENANT2, 'shared'))?.value).toBe('tenant2-data');
  });

  it('forget clears entire identity namespace, leaves others intact', async () => {
    await store.put(ID_A, makeEntry('k1'));
    await store.put(ID_A, makeEntry('k2'));
    await store.put(ID_B, makeEntry('k1'));

    await store.forget(ID_A);

    expect(await store.get(ID_A, 'k1')).toBeNull();
    expect(await store.get(ID_A, 'k2')).toBeNull();
    expect(await store.get(ID_B, 'k1')).not.toBeNull();
  });

  it('seen + recordSignature — recognition flow', async () => {
    expect(await store.seen(ID_A, 'sig-1')).toBe(false);
    await store.recordSignature(ID_A, 'sig-1');
    expect(await store.seen(ID_A, 'sig-1')).toBe(true);
    // Isolated by identity
    expect(await store.seen(ID_B, 'sig-1')).toBe(false);
  });

  it('feedback aggregation over multiple calls', async () => {
    await store.put(ID_A, makeEntry('k1'));
    await store.feedback(ID_A, 'k1', 1);
    await store.feedback(ID_A, 'k1', -1);
    await store.feedback(ID_A, 'k1', 1);
    const f = await store.getFeedback(ID_A, 'k1');
    expect(f?.count).toBe(3);
    expect(f?.average).toBeCloseTo(1 / 3, 6);
  });
});

// ── Property ────────────────────────────────────────────────

describe('InMemoryStore — property', () => {
  it('put then get then put preserves version across roundtrip', async () => {
    const e = makeEntry('k1', { version: 7 });
    await store.put(ID_A, e);
    const got = await store.get(ID_A, 'k1');
    expect(got?.version).toBe(7);
  });

  it('list pages are non-overlapping and cover all entries', async () => {
    const N = 7;
    for (let i = 0; i < N; i++) await store.put(ID_A, makeEntry(`k${i}`));

    const seen = new Set<string>();
    let cursor: string | undefined = undefined;
    let pages = 0;
    do {
      const page: { entries: readonly MemoryEntry[]; cursor?: string } = await store.list(ID_A, {
        limit: 3,
        cursor,
      });
      for (const e of page.entries) {
        expect(seen.has(e.id)).toBe(false); // no overlap
        seen.add(e.id);
      }
      cursor = page.cursor;
      pages++;
      if (pages > 10) throw new Error('pagination runaway'); // safety
    } while (cursor);

    expect(seen.size).toBe(N);
  });

  it('feedback clamps usefulness to [-1, 1]', async () => {
    await store.put(ID_A, makeEntry('k1'));
    await store.feedback(ID_A, 'k1', 100);
    await store.feedback(ID_A, 'k1', -100);
    const f = await store.getFeedback(ID_A, 'k1');
    expect(f?.average).toBeCloseTo(0, 6); // (1 + -1) / 2
  });
});

// ── Security ────────────────────────────────────────────────

describe('InMemoryStore — security', () => {
  it('identical conversationId under different tenants does NOT collide', async () => {
    // Regression for the most consequential multi-tenant leak.
    const bugShape: MemoryIdentity = { tenant: 'tenant-A', conversationId: 'c1' };
    const attacker: MemoryIdentity = { tenant: 'tenant-B', conversationId: 'c1' };
    await store.put(bugShape, makeEntry('secret', { value: 'tenant-A-only' }));
    expect(await store.get(attacker, 'secret')).toBeNull();
  });

  it('missing tenant does not collapse into a tenanted namespace', async () => {
    // Identity { principal: 'u1', conversationId: 'c1' } must NOT read
    // from { tenant: 'anon', principal: 'u1', conversationId: 'c1' }.
    const noTenant: MemoryIdentity = { principal: 'u1', conversationId: 'c1' };
    const tenanted: MemoryIdentity = { tenant: 'anon', principal: 'u1', conversationId: 'c1' };
    await store.put(tenanted, makeEntry('k', { value: 'tenanted-data' }));
    expect(await store.get(noTenant, 'k')).toBeNull();
  });

  it('recordSignature is isolated per identity', async () => {
    await store.recordSignature(ID_A, 'evil-signature');
    expect(await store.seen(ID_B, 'evil-signature')).toBe(false);
  });

  it('forget scrubs entries AND feedback stats', async () => {
    await store.put(ID_A, makeEntry('k1'));
    await store.feedback(ID_A, 'k1', 1);
    await store.forget(ID_A);
    expect(await store.getFeedback(ID_A, 'k1')).toBeNull();
  });

  it('prototype-pollution-shaped ids do not leak into other slots', async () => {
    // Using a Map (not a plain object) as the top-level storage avoids
    // classic `__proto__` pollution — this test pins that protection.
    const polluted: MemoryIdentity = { conversationId: '__proto__' };
    await store.put(polluted, makeEntry('k', { value: 'polluted' }));
    // A "normal" identity shouldn't see the pollution as a property.
    const normal: MemoryIdentity = { conversationId: 'normal' };
    expect(await store.get(normal, 'k')).toBeNull();
  });
});

// ── putMany — batch write ────────────────────────────────────

describe('InMemoryStore — putMany', () => {
  it('writes all entries in the batch (unit)', async () => {
    const entries = [makeEntry('a'), makeEntry('b'), makeEntry('c')];
    await store.putMany(ID_A, entries);
    expect((await store.get(ID_A, 'a'))?.id).toBe('a');
    expect((await store.get(ID_A, 'b'))?.id).toBe('b');
    expect((await store.get(ID_A, 'c'))?.id).toBe('c');
  });

  it('empty batch is a no-op (boundary)', async () => {
    await expect(store.putMany(ID_A, [])).resolves.toBeUndefined();
    const listed = await store.list(ID_A);
    expect(listed.entries.length).toBe(0);
  });

  it('respects tenant isolation like put (security)', async () => {
    await store.putMany(ID_A, [makeEntry('k', { value: 'tenant-A' })]);
    expect(await store.get(ID_TENANT2, 'k')).toBeNull();
  });

  it('last-write-wins for duplicate ids within one batch (boundary)', async () => {
    await store.putMany(ID_A, [
      makeEntry('dup', { value: 'first', version: 1 }),
      makeEntry('dup', { value: 'second', version: 2 }),
    ]);
    const got = await store.get(ID_A, 'dup');
    expect(got?.value).toBe('second');
    expect(got?.version).toBe(2);
  });

  it('putMany equivalent to N sequential put calls (property)', async () => {
    const storeBatch = new InMemoryStore();
    const storeSeq = new InMemoryStore();
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry(`k${i}`));

    await storeBatch.putMany(ID_A, entries);
    for (const e of entries) await storeSeq.put(ID_A, e);

    const batchListed = await storeBatch.list(ID_A, { limit: 100 });
    const seqListed = await storeSeq.list(ID_A, { limit: 100 });
    expect(batchListed.entries.length).toBe(seqListed.entries.length);
    expect(new Set(batchListed.entries.map((e) => e.id))).toEqual(
      new Set(seqListed.entries.map((e) => e.id)),
    );
  });

  it('multi-identity scenario: separate batches per identity isolate cleanly', async () => {
    // Realistic use: two tenants each persist a turn's messages in one
    // putMany. Neither sees the other, each sees its own entries.
    const turnA = [makeEntry('msg-1-0', { value: 'a0' }), makeEntry('msg-1-1', { value: 'a1' })];
    const turnB = [makeEntry('msg-1-0', { value: 'b0' }), makeEntry('msg-1-1', { value: 'b1' })];

    await store.putMany(ID_A, turnA);
    await store.putMany(ID_TENANT2, turnB);

    const listA = await store.list(ID_A, { limit: 10 });
    const listB = await store.list(ID_TENANT2, { limit: 10 });
    expect(listA.entries.length).toBe(2);
    expect(listB.entries.length).toBe(2);
    // Same ids, disjoint values — identity-namespace isolation verified.
    const valuesA = new Set(listA.entries.map((e) => e.value));
    const valuesB = new Set(listB.entries.map((e) => e.value));
    expect(valuesA).toEqual(new Set(['a0', 'a1']));
    expect(valuesB).toEqual(new Set(['b0', 'b1']));
  });
});
