/**
 * Sample 23: Memory Store Adapters
 *
 * agentfootprint ships adapter factories for Redis, PostgreSQL, and DynamoDB.
 * Consumer brings their own client — zero new dependencies.
 *
 *   redisStore(client)    → ioredis / node-redis
 *   postgresStore(client) → pg (node-postgres)
 *   dynamoStore(client)   → @aws-sdk/lib-dynamodb
 */
import { describe, it, expect } from 'vitest';
import { redisStore, postgresStore, dynamoStore } from '../../src/adapters/memory/stores';
import type { Message } from '../../src/types';
import { userMessage, assistantMessage } from '../../src/types';

// ── Mock clients (duck-typed) ──────────────────────────────

function mockRedis(): { get: any; set: any; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string, ...args: unknown[]) => {
      data.set(key, value);
      return 'OK';
    },
  };
}

function mockPostgres(): { query: any; rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    query: async (text: string, values?: unknown[]) => {
      if (text.startsWith('SELECT')) {
        const id = values?.[0] as string;
        const row = rows.get(id);
        return { rows: row ? [row] : [] };
      }
      if (text.startsWith('INSERT')) {
        const id = values?.[0] as string;
        const messages = JSON.parse(values?.[1] as string);
        rows.set(id, { id, messages });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function mockDynamo(): { get: any; put: any; items: Map<string, Record<string, unknown>> } {
  const items = new Map<string, Record<string, unknown>>();
  return {
    items,
    get: async (_table: string, key: Record<string, unknown>) => {
      const id = Object.values(key)[0] as string;
      return items.get(id) ?? null;
    },
    put: async (_table: string, item: Record<string, unknown>) => {
      const id = Object.values(item)[0] as string;
      items.set(id, item);
    },
  };
}

const testMessages: Message[] = [
  userMessage('Hello'),
  assistantMessage('Hi there!'),
];

describe('Sample 23: Memory Store Adapters', () => {
  // ── Redis ──────────────────────────────────────────────────

  it('redisStore — save and load roundtrip', async () => {
    const client = mockRedis();
    const store = redisStore(client);

    await store.save('conv-1', testMessages);
    const loaded = await store.load('conv-1');

    expect(loaded).toHaveLength(2);
    expect(loaded![0].role).toBe('user');
    expect(loaded![1].role).toBe('assistant');
  });

  it('redisStore — load returns null for missing conversation', async () => {
    const client = mockRedis();
    const store = redisStore(client);

    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('redisStore — custom prefix', async () => {
    const client = mockRedis();
    const store = redisStore(client, { prefix: 'myapp:' });

    await store.save('conv-1', testMessages);
    expect(client.data.has('myapp:conv-1')).toBe(true);
  });

  it('redisStore — TTL with ttlSeconds: 0 still stores', async () => {
    const client = mockRedis();
    const store = redisStore(client, { ttlSeconds: 0 });

    await store.save('conv-1', testMessages);
    const loaded = await store.load('conv-1');
    expect(loaded).toHaveLength(2);
  });

  // ── PostgreSQL ─────────────────────────────────────────────

  it('postgresStore — save and load roundtrip', async () => {
    const client = mockPostgres();
    const store = postgresStore(client);

    await store.save('conv-1', testMessages);
    const loaded = await store.load('conv-1');

    expect(loaded).toHaveLength(2);
  });

  it('postgresStore — rejects unsafe table name', () => {
    const client = mockPostgres();
    expect(() => postgresStore(client, { tableName: 'DROP TABLE; --' })).toThrow('Invalid table name');
  });

  it('postgresStore — load returns null for missing', async () => {
    const client = mockPostgres();
    const store = postgresStore(client);

    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });

  // ── DynamoDB ───────────────────────────────────────────────

  it('dynamoStore — save and load roundtrip', async () => {
    const client = mockDynamo();
    const store = dynamoStore(client, { tableName: 'conversations' });

    await store.save('conv-1', testMessages);
    const loaded = await store.load('conv-1');

    expect(loaded).toHaveLength(2);
  });

  it('dynamoStore — custom partition key', async () => {
    const client = mockDynamo();
    const store = dynamoStore(client, { tableName: 'chats', partitionKey: 'chatId' });

    await store.save('chat-1', testMessages);
    expect(client.items.has('chat-1')).toBe(true);
  });

  it('dynamoStore — load returns null for missing', async () => {
    const client = mockDynamo();
    const store = dynamoStore(client, { tableName: 'conversations' });

    const loaded = await store.load('nonexistent');
    expect(loaded).toBeNull();
  });
});
