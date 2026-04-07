/**
 * Memory store adapter factories — consumer brings their own client.
 *
 * Zero new dependencies. Each factory wraps the consumer's client instance
 * into a ConversationStore that implements load() + save().
 *
 * @example Redis
 * ```typescript
 * import Redis from 'ioredis';
 * import { redisStore } from 'agentfootprint';
 *
 * const store = redisStore(new Redis(), { ttlSeconds: 3600 });
 * agent.memory({ store, conversationId: 'session-123' });
 * ```
 *
 * @example DynamoDB
 * ```typescript
 * import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
 * import { dynamoStore } from 'agentfootprint';
 *
 * const store = dynamoStore(new DynamoDBClient({}), { tableName: 'conversations' });
 * agent.memory({ store, conversationId: 'session-123' });
 * ```
 */

import type { ConversationStore } from './types';
import type { Message } from '../../types/messages';

// ── Redis Store ─────────────────────────────────────────────

/**
 * Duck-typed Redis client — works with ioredis and node-redis v4+.
 * Uses variadic `set()` for ioredis compat and options object for node-redis v4.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

export interface RedisStoreOptions {
  /** Key prefix. Default: 'agentfp:conv:' */
  prefix?: string;
  /** TTL in seconds. Default: no expiry. */
  ttlSeconds?: number;
}

/**
 * Create a ConversationStore backed by Redis.
 * Consumer provides their own Redis client (ioredis, redis, etc.).
 */
export function redisStore(client: RedisLike, options?: RedisStoreOptions): ConversationStore {
  const prefix = options?.prefix ?? 'agentfp:conv:';
  const ttl = options?.ttlSeconds;
  const hasTtl = ttl !== undefined && ttl !== null;

  return {
    async load(conversationId: string): Promise<Message[] | null> {
      const data = await client.get(`${prefix}${conversationId}`);
      if (!data) return null;
      try {
        return JSON.parse(data) as Message[];
      } catch {
        return null;
      }
    },

    async save(conversationId: string, messages: Message[]): Promise<void> {
      const key = `${prefix}${conversationId}`;
      const value = JSON.stringify(messages);
      try {
        if (hasTtl) {
          // ioredis: set(key, value, 'EX', ttl) — node-redis v4: set(key, value, { EX: ttl })
          // Try options object first (node-redis v4), fall back to variadic (ioredis)
          try {
            await client.set(key, value, { EX: ttl } as unknown as string);
          } catch {
            await client.set(key, value, 'EX', ttl!);
          }
        } else {
          await client.set(key, value);
        }
      } catch {
        /* fire-and-forget — ConversationStore contract */
      }
    },
  };
}

// ── DynamoDB Store ──────────────────────────────────────────

/**
 * Duck-typed DynamoDB adapter — consumer provides get/put functions.
 *
 * This avoids depending on specific AWS SDK versions or Command class imports.
 * The consumer wraps their own client:
 *
 * ```typescript
 * import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
 *
 * const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
 * const store = dynamoStore({
 *   get: async (table, key) => {
 *     const result = await docClient.send(new GetCommand({ TableName: table, Key: key }));
 *     return result.Item ?? null;
 *   },
 *   put: async (table, item) => {
 *     await docClient.send(new PutCommand({ TableName: table, Item: item }));
 *   },
 * }, { tableName: 'conversations' });
 * ```
 */
export interface DynamoLike {
  get(tableName: string, key: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  put(tableName: string, item: Record<string, unknown>): Promise<void>;
}

export interface DynamoStoreOptions {
  /** DynamoDB table name. Required. */
  tableName: string;
  /** Partition key name. Default: 'id'. */
  partitionKey?: string;
}

/**
 * Create a ConversationStore backed by DynamoDB.
 * Consumer provides a thin wrapper around their DynamoDB client.
 */
export function dynamoStore(client: DynamoLike, options: DynamoStoreOptions): ConversationStore {
  const { tableName, partitionKey = 'id' } = options;

  return {
    async load(conversationId: string): Promise<Message[] | null> {
      try {
        const item = await client.get(tableName, { [partitionKey]: conversationId });
        if (!item) return null;
        const data = item.messages;
        if (typeof data === 'string') return JSON.parse(data) as Message[];
        if (Array.isArray(data)) return data as Message[];
        return null;
      } catch {
        return null;
      }
    },

    async save(conversationId: string, messages: Message[]): Promise<void> {
      try {
        await client.put(tableName, {
          [partitionKey]: conversationId,
          messages: JSON.stringify(messages),
          updatedAt: Date.now(),
        });
      } catch {
        /* fire-and-forget — ConversationStore contract */
      }
    },
  };
}

// ── PostgreSQL Store ────────────────────────────────────────

/** Duck-typed Postgres client — works with pg (node-postgres) or any client with query(text, values). */
export interface PostgresLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PostgresStoreOptions {
  /** Table name. Default: 'conversations'. */
  tableName?: string;
}

/**
 * Create a ConversationStore backed by PostgreSQL.
 * Consumer provides their own pg client/pool.
 *
 * Expects table: CREATE TABLE conversations (id TEXT PRIMARY KEY, messages JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());
 */
const SAFE_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export function postgresStore(
  client: PostgresLike,
  options?: PostgresStoreOptions,
): ConversationStore {
  const table = options?.tableName ?? 'conversations';
  if (!SAFE_TABLE_NAME.test(table)) {
    throw new Error(`Invalid table name "${table}". Use alphanumeric + underscore only.`);
  }

  return {
    async load(conversationId: string): Promise<Message[] | null> {
      const result = await client.query(`SELECT messages FROM ${table} WHERE id = $1`, [
        conversationId,
      ]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as { messages: Message[] };
      return row.messages;
    },

    async save(conversationId: string, messages: Message[]): Promise<void> {
      try {
        await client.query(
          `INSERT INTO ${table} (id, messages, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET messages = $2, updated_at = NOW()`,
          [conversationId, JSON.stringify(messages)],
        );
      } catch {
        /* fire-and-forget — ConversationStore contract */
      }
    },
  };
}
