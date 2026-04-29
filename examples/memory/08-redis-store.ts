/**
 * 08 — RedisStore: persistent MemoryStore via Redis (peer-dep `ioredis`).
 *
 * Subpath import: `agentfootprint/memory-redis`. Lazy-required SDK —
 * the host process never loads `ioredis` unless this adapter is used.
 *
 * Production usage:
 *
 *   import { RedisStore } from 'agentfootprint/memory-redis';
 *   const store = new RedisStore({ url: 'redis://localhost:6379' });
 *
 * This example uses an injected mock Redis client (`_client`) so the
 * file runs end-to-end without a live Redis instance. The `MemoryStore`
 * surface is identical — code that uses one works with the other.
 */

import {
  Agent,
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  mock,
  type LLMProvider,
} from '../../src/index.js';
import {
  RedisStore,
  type RedisLikeClient,
  type RedisLikePipeline,
} from '../../src/adapters/memory/redis.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/08-redis-store',
  title: 'RedisStore — persistent MemoryStore via Redis',
  group: 'memory',
  description:
    'Drop-in replacement for InMemoryStore that persists entries in Redis. ' +
    'Mock-injected here so the example runs offline; in production pass ' +
    '`{ url }` instead of `_client`.',
  defaultInput: 'What did I tell you?',
  providerSlots: ['default'],
  tags: ['memory', 'adapter', 'redis', 'peer-dep'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const fakeRedis = makeFakeRedis();
  const store = new RedisStore({ _client: fakeRedis });

  const memory = defineMemory({
    id: 'redis-window',
    description: 'Last 10 turns persisted in Redis.',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store,
  });

  const agent = Agent.create({
    provider:
      provider ??
      mock({ reply: "I remember — you mentioned your name is Alice earlier." }),
    model: 'mock',
    maxIterations: 1,
  })
    .system('You remember conversations across runs via Redis.')
    .memory(memory)
    .build();

  const identity = { tenant: 'demo', principal: 'alice', conversationId: 'redis-thread' };

  await agent.run({ message: 'My name is Alice.', identity });

  const result = await agent.run({ message: input, identity });
  await store.close();
  if (typeof result !== 'string') throw new Error('Agent paused unexpectedly.');
  return result;
}

function makeFakeRedis(): RedisLikeClient {
  const kv = new Map<string, { value: string; expiresAt?: number }>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();

  const client: RedisLikeClient = {
    async get(key) {
      const e = kv.get(key);
      if (!e) return null;
      if (e.expiresAt !== undefined && e.expiresAt <= Date.now()) {
        kv.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, ...args) {
      const px = parsePx(args);
      kv.set(key, px !== undefined ? { value, expiresAt: Date.now() + px } : { value });
      return 'OK';
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) {
        if (kv.delete(k)) n++;
        if (sets.delete(k)) n++;
        if (hashes.delete(k)) n++;
      }
      return n;
    },
    async sadd(key, ...members) {
      const s = sets.get(key) ?? new Set<string>();
      const before = s.size;
      for (const m of members) s.add(m);
      sets.set(key, s);
      return s.size - before;
    },
    async srem(key, ...members) {
      const s = sets.get(key);
      if (!s) return 0;
      let n = 0;
      for (const m of members) if (s.delete(m)) n++;
      return n;
    },
    async sismember(key, member) {
      return sets.get(key)?.has(member) ? 1 : 0;
    },
    async smembers(key) {
      return [...(sets.get(key) ?? [])];
    },
    async hgetall(key) {
      const h = hashes.get(key);
      return h ? Object.fromEntries(h.entries()) : {};
    },
    async hset(key, ...args) {
      const h = hashes.get(key) ?? new Map<string, string>();
      let added = 0;
      for (let i = 0; i < args.length; i += 2) {
        const f = String(args[i]);
        const v = String(args[i + 1]);
        if (!h.has(f)) added++;
        h.set(f, v);
      }
      hashes.set(key, h);
      return added;
    },
    async scan(cursor, _m, pattern, _c, _n) {
      if (cursor !== '0') return ['0', []];
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      const all = [...kv.keys(), ...sets.keys(), ...hashes.keys()];
      return ['0', all.filter((k) => re.test(k))];
    },
    async eval(_script, _n, ..._a) {
      return [1];
    },
    pipeline(): RedisLikePipeline {
      const ops: Array<() => Promise<unknown>> = [];
      const pipe: RedisLikePipeline = {
        set: (k, v, ...a) => {
          ops.push(() => client.set(k, v, ...a));
          return pipe;
        },
        sadd: (k, ...m) => {
          ops.push(() => client.sadd(k, ...m));
          return pipe;
        },
        exec: async () => {
          for (const op of ops) await op();
          return [];
        },
      };
      return pipe;
    },
    async quit() {
      return 'OK';
    },
  };
  return client;
}

function parsePx(args: ReadonlyArray<string | number>): number | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (String(args[i]).toUpperCase() === 'PX') return Number(args[i + 1]);
  }
  return undefined;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
