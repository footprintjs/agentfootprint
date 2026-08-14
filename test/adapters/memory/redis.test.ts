/**
 * RedisStore — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * SDK is mock-injected via `_client` so the suite runs without a live
 * Redis instance.
 */

import { describe, expect, it } from 'vitest';

import { RedisStore } from '../../../src/adapters/memory/redis.js';
import type { RedisLikeClient, RedisLikePipeline } from '../../../src/adapters/memory/redis.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';
import { redisStringMatch } from './redisGlob.js';

interface SetEntry {
  value: string;
  expiresAt?: number;
}

class MockRedis implements RedisLikeClient {
  readonly kv = new Map<string, SetEntry>();
  readonly sets = new Map<string, Set<string>>();
  readonly hashes = new Map<string, Map<string, string>>();
  closed = false;

  private isExpired(e: SetEntry): boolean {
    return e.expiresAt !== undefined && e.expiresAt <= Date.now();
  }

  async get(key: string): Promise<string | null> {
    const e = this.kv.get(key);
    if (!e) return null;
    if (this.isExpired(e)) {
      this.kv.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ...args: ReadonlyArray<string | number>): Promise<unknown> {
    const px = parsePx(args);
    this.kv.set(key, px !== undefined ? { value, expiresAt: Date.now() + px } : { value });
    return 'OK';
  }

  async del(...keys: ReadonlyArray<string>): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.kv.delete(k)) n++;
      if (this.sets.delete(k)) n++;
      if (this.hashes.delete(k)) n++;
    }
    return n;
  }

  async sadd(key: string, ...members: ReadonlyArray<string>): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    for (const m of members) set.add(m);
    this.sets.set(key, set);
    return set.size - before;
  }

  async srem(key: string, ...members: ReadonlyArray<string>): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let n = 0;
    for (const m of members) if (set.delete(m)) n++;
    return n;
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  async smembers(key: string): Promise<readonly string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(key);
    if (!h) return {};
    return Object.fromEntries(h.entries());
  }

  async hset(key: string, ...args: ReadonlyArray<string | number>): Promise<number> {
    const h = this.hashes.get(key) ?? new Map<string, string>();
    let added = 0;
    for (let i = 0; i < args.length; i += 2) {
      const f = String(args[i]);
      const v = String(args[i + 1]);
      if (!h.has(f)) added++;
      h.set(f, v);
    }
    this.hashes.set(key, h);
    return added;
  }

  async scan(
    cursor: string,
    _matchKW: 'MATCH',
    pattern: string,
    _countKW: 'COUNT',
    _n: number,
  ): Promise<readonly [string, readonly string[]]> {
    if (cursor !== '0') return ['0', []];
    const allKeys = [...this.kv.keys(), ...this.sets.keys(), ...this.hashes.keys()];
    // Redis's own matcher, not a RegExp approximation of it: `?` and `[a-z]`
    // are metacharacters the server honours, and a `\` in a pattern is a GLOB
    // escape, not a regex one. A double that gets that wrong cannot prove
    // anything about glob injection — see redisGlob.ts.
    return ['0', allKeys.filter((k) => redisStringMatch(pattern, k))];
  }

  async eval(
    script: string,
    _numKeys: number,
    ...args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    if (script.includes('cur_version') || script.includes('SADD')) {
      const [eKey, idxKey, expectedV, payload, entryId, px] = args.map(String);
      const expected = parseInt(expectedV!, 10);
      const current = this.kv.get(eKey!);
      if (!current) {
        if (expected !== 0) return [0];
      } else {
        const m = /"version":(\d+)/.exec(current.value);
        const cur = m ? parseInt(m[1]!, 10) : 0;
        if (cur !== expected) return [0, cur];
      }
      if (px && px !== '') {
        await this.set(eKey!, payload!, 'PX', parseInt(px, 10));
      } else {
        await this.set(eKey!, payload!);
      }
      await this.sadd(idxKey!, entryId!);
      return [1];
    }
    const [fbKey, clamped] = args.map(String);
    const h = this.hashes.get(fbKey!) ?? new Map<string, string>();
    const sum = parseFloat(h.get('sum') ?? '0') + parseFloat(clamped!);
    const count = parseInt(h.get('count') ?? '0', 10) + 1;
    h.set('sum', String(sum));
    h.set('count', String(count));
    this.hashes.set(fbKey!, h);
    return 1;
  }

  pipeline(): RedisLikePipeline {
    const ops: Array<() => Promise<unknown>> = [];
    const pipe: RedisLikePipeline = {
      set: (k, v, ...a) => {
        ops.push(() => this.set(k, v, ...a));
        return pipe;
      },
      sadd: (k, ...m) => {
        ops.push(() => this.sadd(k, ...m));
        return pipe;
      },
      exec: async () => {
        for (const op of ops) await op();
        return [];
      },
    };
    return pipe;
  }

  async quit(): Promise<unknown> {
    this.closed = true;
    return 'OK';
  }
}

function parsePx(args: ReadonlyArray<string | number>): number | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (String(args[i]).toUpperCase() === 'PX') return Number(args[i + 1]);
  }
  return undefined;
}

const id: MemoryIdentity = { tenant: 'acme', principal: 'alice', conversationId: 'thread-1' };
const id2: MemoryIdentity = { tenant: 'acme', principal: 'bob', conversationId: 'thread-1' };

function makeEntry(idStr: string, opts: Partial<MemoryEntry> = {}): MemoryEntry<{ text: string }> {
  const now = Date.now();
  return {
    id: idStr,
    value: { text: `value-${idStr}` },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...opts,
  };
}

describe('RedisStore — unit (basics)', () => {
  it('throws when constructed without url, client, or _client', () => {
    expect(() => new RedisStore()).toThrow(/requires `url` or `client`/);
  });

  it('get/put round-trip', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('a'));
    const got = await store.get<{ text: string }>(id, 'a');
    expect(got?.value.text).toBe('value-a');
    expect(got?.version).toBe(1);
  });

  it('get returns null for missing key', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    expect(await store.get(id, 'nope')).toBeNull();
  });

  it('TTL: get returns null after entry expires', async () => {
    const mock = new MockRedis();
    const store = new RedisStore({ _client: mock });
    await store.put(id, makeEntry('e', { ttl: Date.now() + 50 }));
    expect(await store.get(id, 'e')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(await store.get(id, 'e')).toBeNull();
  });

  it('TTL=0 (already expired) refuses to write', async () => {
    const mock = new MockRedis();
    const store = new RedisStore({ _client: mock });
    await store.put(id, makeEntry('e', { ttl: Date.now() - 1 }));
    expect(await store.get(id, 'e')).toBeNull();
    expect(mock.kv.size).toBe(0);
  });

  it('putMany batches via pipeline; empty batch is no-op', async () => {
    const mock = new MockRedis();
    const store = new RedisStore({ _client: mock });
    await store.putMany(id, []);
    expect(mock.kv.size).toBe(0);
    await store.putMany(id, [makeEntry('a'), makeEntry('b'), makeEntry('c')]);
    const r = await store.list(id);
    expect(r.entries.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('list paginates via cursor', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    for (let i = 0; i < 5; i++) await store.put(id, makeEntry(`e${i}`));
    const p1 = await store.list(id, { limit: 2 });
    expect(p1.entries.length).toBe(2);
    expect(p1.cursor).toBeDefined();
    const p2 = await store.list(id, { limit: 2, cursor: p1.cursor });
    expect(p2.entries.length).toBe(2);
    const p3 = await store.list(id, { limit: 2, cursor: p2.cursor });
    expect(p3.entries.length).toBe(1);
    expect(p3.cursor).toBeUndefined();
  });

  it('list filters by tier', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('h', { tier: 'hot' }));
    await store.put(id, makeEntry('w', { tier: 'warm' }));
    const r = await store.list(id, { tiers: ['hot'] });
    expect(r.entries.map((e) => e.id)).toEqual(['h']);
  });

  it('delete removes both entry and feedback', async () => {
    const mock = new MockRedis();
    const store = new RedisStore({ _client: mock });
    await store.put(id, makeEntry('a'));
    await store.feedback(id, 'a', 0.7);
    await store.delete(id, 'a');
    expect(await store.get(id, 'a')).toBeNull();
    expect(await store.getFeedback(id, 'a')).toBeNull();
  });
});

describe('RedisStore — putIfVersion (CAS)', () => {
  it('first-write succeeds when expectedVersion=0', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    const r = await store.putIfVersion(id, makeEntry('a', { version: 1 }), 0);
    expect(r.applied).toBe(true);
  });

  it('rejects expectedVersion!=0 when entry does not exist', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    const r = await store.putIfVersion(id, makeEntry('a', { version: 5 }), 4);
    expect(r.applied).toBe(false);
  });

  it('succeeds when expectedVersion matches stored version', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('a', { version: 3 }));
    const r = await store.putIfVersion(id, makeEntry('a', { version: 4 }), 3);
    expect(r.applied).toBe(true);
    const after = await store.get(id, 'a');
    expect(after?.version).toBe(4);
  });

  it('rejects + returns currentVersion on stale CAS', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('a', { version: 5 }));
    const r = await store.putIfVersion(id, makeEntry('a', { version: 6 }), 3);
    expect(r.applied).toBe(false);
    expect(r.currentVersion).toBe(5);
  });
});

describe('RedisStore — signatures + feedback', () => {
  it('seen/recordSignature round-trip', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    expect(await store.seen(id, 'hash-1')).toBe(false);
    await store.recordSignature(id, 'hash-1');
    expect(await store.seen(id, 'hash-1')).toBe(true);
  });

  it('feedback rejects non-finite (NaN poisons running mean)', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('a'));
    await store.feedback(id, 'a', Number.NaN);
    await store.feedback(id, 'a', Number.POSITIVE_INFINITY);
    expect(await store.getFeedback(id, 'a')).toBeNull();
    await store.feedback(id, 'a', 0.5);
    const f = await store.getFeedback(id, 'a');
    expect(f?.average).toBeCloseTo(0.5, 6);
    expect(f?.count).toBe(1);
  });

  it('feedback clamps out-of-range to [-1, 1]', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.feedback(id, 'a', 9.9);
    await store.feedback(id, 'a', -9.9);
    const f = await store.getFeedback(id, 'a');
    expect(f?.average).toBeCloseTo(0, 6);
    expect(f?.count).toBe(2);
  });
});

/**
 * The test double's matcher, checked against the examples Redis itself
 * publishes for `KEYS` — because everything below rests on it behaving like
 * the server. If this block is wrong, the isolation tests underneath it are
 * measuring a fiction.
 *
 * @see https://redis.io/docs/latest/commands/keys/
 */
describe('the glob harness matches documented Redis semantics', () => {
  it("h?llo matches hello, hallo and hxllo — but not 'hllo'", () => {
    for (const k of ['hello', 'hallo', 'hxllo']) expect(redisStringMatch('h?llo', k)).toBe(true);
    expect(redisStringMatch('h?llo', 'hllo')).toBe(false);
  });

  it('h*llo matches hllo and heeeello', () => {
    for (const k of ['hllo', 'heeeello']) expect(redisStringMatch('h*llo', k)).toBe(true);
  });

  it('h[ae]llo matches hello and hallo, but not hillo', () => {
    expect(redisStringMatch('h[ae]llo', 'hello')).toBe(true);
    expect(redisStringMatch('h[ae]llo', 'hallo')).toBe(true);
    expect(redisStringMatch('h[ae]llo', 'hillo')).toBe(false);
  });

  it('h[^e]llo matches hallo and hbllo, but not hello', () => {
    expect(redisStringMatch('h[^e]llo', 'hallo')).toBe(true);
    expect(redisStringMatch('h[^e]llo', 'hbllo')).toBe(true);
    expect(redisStringMatch('h[^e]llo', 'hello')).toBe(false);
  });

  it('h[a-b]llo matches hallo and hbllo, but not hcllo', () => {
    expect(redisStringMatch('h[a-b]llo', 'hallo')).toBe(true);
    expect(redisStringMatch('h[a-b]llo', 'hbllo')).toBe(true);
    expect(redisStringMatch('h[a-b]llo', 'hcllo')).toBe(false);
  });

  it('a backslash escapes the next character verbatim', () => {
    expect(redisStringMatch('a\\*b', 'a*b')).toBe(true);
    expect(redisStringMatch('a\\*b', 'axb')).toBe(false);
    expect(redisStringMatch('a\\*b', 'axxxb')).toBe(false);
    expect(redisStringMatch('a\\?b', 'a?b')).toBe(true);
    expect(redisStringMatch('a\\?b', 'axb')).toBe(false);
    expect(redisStringMatch('a\\[b', 'a[b')).toBe(true);
    expect(redisStringMatch('a\\\\b', 'a\\b')).toBe(true);
  });

  it('a ] outside a class is an ordinary character — which is why it is not escaped', () => {
    expect(redisStringMatch('a]b', 'a]b')).toBe(true);
    expect(redisStringMatch('a]b', 'axb')).toBe(false);
  });

  it('an unescaped wildcard really does span the namespace separators', () => {
    // The defect itself, stated as the harness sees it: `*` does not stop at
    // `/` or `:`, so a conversation id of `*` reaches every sibling…
    expect(redisStringMatch('af:t1/u1/*:*', 'af:t1/u1/c1:e:x')).toBe(true);
    // …and a whole tuple of them reaches the entire keyspace.
    expect(redisStringMatch('af:*/*/*:*', 'af:t9/u9/c9:e:x')).toBe(true);
  });

  it('`_` is NOT a wildcard here — it is one in SQL LIKE, and that difference matters', () => {
    // Worth pinning because the absence marker the encoder emits is `_`, and
    // the same string means "any single character" in a LIKE clause. Redis
    // glob compares it literally, so the anonymous namespace matches only
    // itself.
    expect(redisStringMatch('af:_/_/c1:*', 'af:t1/u1/c1:e:x')).toBe(false);
    expect(redisStringMatch('af:_/_/c1:*', 'af:_/_/c1:e:x')).toBe(true);
  });
});

describe('RedisStore — multi-tenant isolation', () => {
  it('writes under tenant A do not appear under tenant B', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('shared'));
    expect(await store.get(id2, 'shared')).toBeNull();
    expect(await store.get(id, 'shared')).not.toBeNull();
  });

  it('forget removes only the target identity', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('a'));
    await store.put(id2, makeEntry('a'));
    await store.recordSignature(id, 'sig-1');
    await store.feedback(id, 'a', 0.8);
    await store.forget(id);
    expect(await store.get(id, 'a')).toBeNull();
    expect(await store.seen(id, 'sig-1')).toBe(false);
    expect(await store.getFeedback(id, 'a')).toBeNull();
    expect(await store.get(id2, 'a')).not.toBeNull();
  });

  /**
   * `forget` is the one method that DELETES by pattern, and a key is data
   * while a MATCH pattern is a glob. An id carrying a glob character used to
   * be pasted into the pattern raw, so `{ conversationId: '*' }` scanned
   * `af:_/_/*:*` — which matches every other scope's keys — and then deleted
   * what it found. Cross-tenant destruction, from an id that is merely odd.
   *
   * The assertion that matters is not "the right keys died" but "the WRONG
   * ones survived", so every case below checks the neighbour.
   */
  const GLOBBY: ReadonlyArray<[string, MemoryIdentity]> = [
    ['a bare asterisk', { tenant: 't1', principal: 'u1', conversationId: '*' }],
    ['an asterisk inside a name', { tenant: 't1', principal: 'u1', conversationId: 'c*' }],
    ['a single-character wildcard', { tenant: 't1', principal: 'u1', conversationId: '?' }],
    ['a character class', { tenant: 't1', principal: 'u1', conversationId: '[a-z]' }],
    ['a negated class', { tenant: 't1', principal: 'u1', conversationId: '[^q]' }],
    ['an escape character', { tenant: 't1', principal: 'u1', conversationId: '\\' }],
    ['an already-escaped-looking name', { tenant: 't1', principal: 'u1', conversationId: '\\*' }],
    ['every metacharacter at once', { tenant: '*?[', principal: '\\', conversationId: '*' }],
  ];

  for (const [what, globby] of GLOBBY) {
    it(`forget with ${what} erases only its own scope`, async () => {
      const store = new RedisStore({ _client: new MockRedis() });
      const neighbour: MemoryIdentity = { tenant: 't1', principal: 'u1', conversationId: 'c1' };
      // A ONE-character sibling as well: `?` matches exactly one character, so
      // a neighbour with a longer id would survive an unescaped pattern by
      // luck rather than by the fix, and the case would prove nothing.
      const short: MemoryIdentity = { tenant: 't1', principal: 'u1', conversationId: 'z' };
      const faraway: MemoryIdentity = { tenant: 't9', principal: 'u9', conversationId: 'c9' };

      await store.put(globby, makeEntry('mine'));
      for (const other of [neighbour, short, faraway]) await store.put(other, makeEntry('theirs'));
      await store.recordSignature(neighbour, 'sig-1');
      await store.feedback(neighbour, 'theirs', 0.5);

      await store.forget(globby);

      // Its own keys are really gone — the escape must not break the erasure.
      expect(await store.get(globby, 'mine')).toBeNull();
      // …and nobody else's are.
      for (const other of [neighbour, short, faraway]) {
        expect(await store.get(other, 'theirs')).not.toBeNull();
      }
      expect(await store.seen(neighbour, 'sig-1')).toBe(true);
      expect(await store.getFeedback(neighbour, 'theirs')).not.toBeNull();
    });
  }
});

describe('RedisStore — lifecycle', () => {
  it('borrowed _client is not quit on close', async () => {
    const mock = new MockRedis();
    const store = new RedisStore({ _client: mock });
    await store.close();
    expect(mock.closed).toBe(false);
  });

  it('post-close calls throw cleanly', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.close();
    await expect(store.get(id, 'x')).rejects.toThrow(/RedisStore\.get\(\) called after close/);
    await expect(store.put(id, makeEntry('x'))).rejects.toThrow(/after close/);
  });

  it('close() is idempotent', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.close();
    await store.close();
  });
});

describe('RedisStore — properties', () => {
  it('JSON round-trip preserves all entry fields', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    const entry = makeEntry('p', {
      tier: 'cold',
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'mock-v1',
      metadata: { author: 'system', urgency: 5 },
      source: { turn: 7, runtimeStageId: 'stage#3' },
    });
    await store.put(id, entry);
    const got = await store.get(id, 'p');
    expect(got?.tier).toBe('cold');
    expect(got?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(got?.metadata?.urgency).toBe(5);
    expect(got?.source?.runtimeStageId).toBe('stage#3');
  });
});

describe('RedisStore — ROI', () => {
  it('drop-in for InMemoryStore — same MemoryStore interface', async () => {
    const store = new RedisStore({ _client: new MockRedis() });
    await store.put(id, makeEntry('a'));
    await store.put(id, makeEntry('b'));
    await store.feedback(id, 'a', 0.9);
    await store.recordSignature(id, 'h1');
    const list = await store.list(id);
    expect(list.entries.length).toBe(2);
    expect((await store.getFeedback(id, 'a'))?.average).toBeCloseTo(0.9, 6);
    expect(await store.seen(id, 'h1')).toBe(true);
    await store.forget(id);
    expect((await store.list(id)).entries.length).toBe(0);
  });
});
