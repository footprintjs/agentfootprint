/**
 * RedisStore — Redis-backed `MemoryStore` adapter (peer-dep `ioredis`).
 *
 * Canonical subpath (v2.5+): `agentfootprint/memory-providers`.
 * Legacy alias (still works through v2.x): `agentfootprint/memory-redis`.
 *
 *   // New canonical (v2.5+):
 *   import { RedisStore } from 'agentfootprint/memory-providers';
 *
 *   // Legacy alias (still works through v2.x; removed in v3.0):
 *   import { RedisStore } from 'agentfootprint/memory-redis';
 *
 *   const store = new RedisStore({ url: 'redis://localhost:6379' });
 *
 * Pattern: Adapter (GoF) — translates the `MemoryStore` interface onto
 *          Redis primitives (key/value for entries, set for signatures,
 *          hash for feedback aggregates).
 * Role:    Outer ring. Lazy-requires `ioredis`; no runtime cost when
 *          another adapter is in use.
 * Emits:   N/A (storage adapters don't emit; recorders observe the
 *          memory pipeline that calls them).
 *
 * Vector search (`search()`) is NOT implemented in this adapter — RedisSearch
 * is a separate Redis module with its own API surface. A `RedisSearchStore`
 * may ship in a future release. RAG users with v2.3 should use
 * `InMemoryStore` until the search-capable adapter lands.
 *
 * Concurrency model:
 *   - `put` / `putMany` use simple SET / pipelined SET (last-write-wins).
 *   - `putIfVersion` uses a small Lua script for atomic version compare-and-swap.
 *   - Multi-writer correctness ⇒ prefer `putIfVersion` in stage code.
 */

import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
} from '../../memory/store/types.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import { identityNamespace } from '../../memory/identity/index.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

/**
 * Minimal `ioredis` client surface this adapter needs. Defined locally so
 * we don't take a hard import on `ioredis` (lazy peer-dep) and tests can
 * inject a mock implementation via `_client`.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: ReadonlyArray<string | number>): Promise<unknown>;
  del(...keys: ReadonlyArray<string>): Promise<number>;
  sadd(key: string, ...members: ReadonlyArray<string>): Promise<number>;
  srem(key: string, ...members: ReadonlyArray<string>): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<readonly string[]>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, ...args: ReadonlyArray<string | number>): Promise<number>;
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    n: number,
  ): Promise<readonly [string, readonly string[]]>;
  eval(script: string, numKeys: number, ...args: ReadonlyArray<string | number>): Promise<unknown>;
  pipeline(): RedisLikePipeline;
  quit(): Promise<unknown>;
}

export interface RedisLikePipeline {
  set(key: string, value: string, ...args: ReadonlyArray<string | number>): RedisLikePipeline;
  sadd(key: string, ...members: ReadonlyArray<string>): RedisLikePipeline;
  exec(): Promise<unknown>;
}

export interface RedisStoreOptions {
  /**
   * Connection URL (e.g. `redis://default:password@host:6379/0`). Required
   * unless `_client` is supplied.
   */
  readonly url?: string;

  /**
   * Pre-built `ioredis` client. Use this when the host app already manages
   * a Redis connection pool. Adapter does NOT call `quit()` on a borrowed
   * client — caller owns the lifecycle.
   */
  readonly client?: RedisLikeClient;

  /** Key prefix for namespace isolation across apps sharing one Redis. Default `'agentfootprint'`. */
  readonly prefix?: string;

  /**
   * SCAN page size when iterating keys. Default 100. Larger = fewer
   * round-trips but more memory per response. Adapter never uses `KEYS *`
   * (which blocks Redis).
   */
  readonly scanCount?: number;

  /**
   * @internal Test injection point. When provided, skips the SDK require.
   */
  readonly _client?: RedisLikeClient;
}

/**
 * Redis-backed `MemoryStore`. Implements every method except `search()`.
 *
 * @throws when `ioredis` is not installed and no `_client` is supplied.
 */
export class RedisStore implements MemoryStore {
  private readonly client: RedisLikeClient;
  private readonly prefix: string;
  private readonly scanCount: number;
  private readonly ownsClient: boolean;
  private closed = false;

  constructor(options: RedisStoreOptions = {}) {
    this.prefix = options.prefix ?? 'agentfootprint';
    this.scanCount = options.scanCount ?? 100;

    if (options._client) {
      this.client = options._client;
      this.ownsClient = false;
    } else if (options.client) {
      this.client = options.client;
      this.ownsClient = false;
    } else if (options.url) {
      this.client = createIoredis(options.url);
      this.ownsClient = true;
    } else {
      throw new Error('RedisStore requires `url` or `client` (or `_client` for tests).');
    }
  }

  // Key helpers

  private nsKey(identity: MemoryIdentity, suffix: string): string {
    return `${this.prefix}:${identityNamespace(identity)}:${suffix}`;
  }

  private entryKey(identity: MemoryIdentity, id: string): string {
    return this.nsKey(identity, `e:${id}`);
  }

  private indexKey(identity: MemoryIdentity): string {
    return this.nsKey(identity, 'idx');
  }

  private sigKey(identity: MemoryIdentity): string {
    return this.nsKey(identity, 'sig');
  }

  private feedbackKey(identity: MemoryIdentity, id: string): string {
    return this.nsKey(identity, `fb:${id}`);
  }

  // MemoryStore implementation

  async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
    this.ensureOpen('get');
    const raw = await this.client.get(this.entryKey(identity, id));
    if (raw === null) return null;
    const entry = parseEntry<T>(raw);
    if (!entry) return null;
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return null;
    return entry;
  }

  async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
    this.ensureOpen('put');
    const payload = JSON.stringify(entry);
    const eKey = this.entryKey(identity, entry.id);
    if (entry.ttl !== undefined) {
      const pxMs = Math.max(0, entry.ttl - Date.now());
      if (pxMs <= 0) return;
      await this.client.set(eKey, payload, 'PX', pxMs);
    } else {
      await this.client.set(eKey, payload);
    }
    await this.client.sadd(this.indexKey(identity), entry.id);
  }

  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
  ): Promise<void> {
    this.ensureOpen('putMany');
    if (entries.length === 0) return;
    const pipeline = this.client.pipeline();
    const ids: string[] = [];
    const now = Date.now();
    for (const entry of entries) {
      const payload = JSON.stringify(entry);
      const eKey = this.entryKey(identity, entry.id);
      if (entry.ttl !== undefined) {
        const pxMs = Math.max(0, entry.ttl - now);
        if (pxMs <= 0) continue;
        pipeline.set(eKey, payload, 'PX', pxMs);
      } else {
        pipeline.set(eKey, payload);
      }
      ids.push(entry.id);
    }
    if (ids.length > 0) pipeline.sadd(this.indexKey(identity), ...ids);
    await pipeline.exec();
  }

  /**
   * Optimistic concurrency via a small Lua script — atomic
   * compare-and-swap on the JSON-encoded `version` field.
   */
  async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
  ): Promise<PutIfVersionResult> {
    this.ensureOpen('putIfVersion');
    const eKey = this.entryKey(identity, entry.id);
    const idxKey = this.indexKey(identity);
    const payload = JSON.stringify(entry);
    const px = entry.ttl !== undefined ? Math.max(0, entry.ttl - Date.now()).toString() : '';
    const result = (await this.client.eval(
      PUT_IF_VERSION_LUA,
      2,
      eKey,
      idxKey,
      String(expectedVersion),
      payload,
      entry.id,
      px,
    )) as readonly [number, number?];
    const applied = result[0] === 1;
    if (applied) return { applied: true };
    return result[1] !== undefined
      ? { applied: false, currentVersion: result[1] }
      : { applied: false };
  }

  async list<T = unknown>(
    identity: MemoryIdentity,
    options: ListOptions = {},
  ): Promise<ListResult<T>> {
    this.ensureOpen('list');
    const idxKey = this.indexKey(identity);
    const ids = await this.client.smembers(idxKey);
    if (ids.length === 0) return { entries: [] };

    const entries: MemoryEntry<T>[] = [];
    for (const id of ids) {
      const raw = await this.client.get(this.entryKey(identity, id));
      if (raw === null) continue;
      const entry = parseEntry<T>(raw);
      if (!entry) continue;
      if (entry.ttl !== undefined && entry.ttl <= Date.now()) continue;
      if (options.tiers && (!entry.tier || !options.tiers.includes(entry.tier))) continue;
      entries.push(entry);
    }

    const start = options.cursor ? parseInt(options.cursor, 10) : 0;
    const limit = options.limit ?? entries.length;
    const page = entries.slice(start, start + limit);
    const next = start + limit;
    return next < entries.length ? { entries: page, cursor: String(next) } : { entries: page };
  }

  async delete(identity: MemoryIdentity, id: string): Promise<void> {
    this.ensureOpen('delete');
    await this.client.del(this.entryKey(identity, id), this.feedbackKey(identity, id));
    await this.client.srem(this.indexKey(identity), id);
  }

  async seen(identity: MemoryIdentity, signature: string): Promise<boolean> {
    this.ensureOpen('seen');
    const result = await this.client.sismember(this.sigKey(identity), signature);
    return result === 1;
  }

  async recordSignature(identity: MemoryIdentity, signature: string): Promise<void> {
    this.ensureOpen('recordSignature');
    await this.client.sadd(this.sigKey(identity), signature);
  }

  async feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void> {
    this.ensureOpen('feedback');
    if (!Number.isFinite(usefulness)) return;
    const clamped = Math.max(-1, Math.min(1, usefulness));
    const fbKey = this.feedbackKey(identity, id);
    await this.client.eval(FEEDBACK_LUA, 1, fbKey, String(clamped));
  }

  async getFeedback(
    identity: MemoryIdentity,
    id: string,
  ): Promise<{ average: number; count: number } | null> {
    this.ensureOpen('getFeedback');
    const fb = await this.client.hgetall(this.feedbackKey(identity, id));
    if (!fb || !fb.count || parseInt(fb.count, 10) === 0) return null;
    const count = parseInt(fb.count, 10);
    const sum = parseFloat(fb.sum ?? '0');
    return { average: sum / count, count };
  }

  /**
   * GDPR — drop every key under this identity's namespace.
   */
  async forget(identity: MemoryIdentity): Promise<void> {
    this.ensureOpen('forget');
    const pattern = `${this.prefix}:${identityNamespace(identity)}:*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        this.scanCount,
      );
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  /**
   * Close the underlying Redis connection — only when this adapter
   * owns it. Borrowed clients (passed via `client` option) are left to
   * the caller. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownsClient) await this.client.quit();
  }

  private ensureOpen(op: string): void {
    if (this.closed) {
      throw new Error(`RedisStore.${op}() called after close().`);
    }
  }
}

// Helpers

function parseEntry<T>(raw: string): MemoryEntry<T> | null {
  try {
    return JSON.parse(raw) as MemoryEntry<T>;
  } catch {
    return null;
  }
}

const PUT_IF_VERSION_LUA = `
local current = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
if current == false then
  if expected ~= 0 then
    return {0}
  end
else
  local cur_version = tonumber(string.match(current, '"version":(%d+)'))
  if cur_version ~= expected then
    return {0, cur_version}
  end
end
if ARGV[4] ~= '' then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', tonumber(ARGV[4]))
else
  redis.call('SET', KEYS[1], ARGV[2])
end
redis.call('SADD', KEYS[2], ARGV[3])
return {1}
`;

const FEEDBACK_LUA = `
redis.call('HINCRBYFLOAT', KEYS[1], 'sum', ARGV[1])
redis.call('HINCRBY', KEYS[1], 'count', 1)
return 1
`;

// Lazy SDK loader

interface IoredisModule {
  readonly default?: new (url: string) => RedisLikeClient;
}

function createIoredis(url: string): RedisLikeClient {
  let mod: IoredisModule | { new (url: string): RedisLikeClient };
  try {
    mod = lazyRequire<IoredisModule>('ioredis');
  } catch {
    throw new Error(
      'RedisStore requires the `ioredis` peer dependency.\n' +
        '  Install:  npm install ioredis\n' +
        '  Or pass `_client` for test injection.',
    );
  }
  const Ctor = (mod as IoredisModule).default ?? (mod as { new (url: string): RedisLikeClient });
  return new Ctor(url);
}
