import { RedisStore } from '../../../src/adapters/memory/redis.js';
import type { RedisLikeClient, RedisLikePipeline } from '../../../src/adapters/memory/redis.js';
import { memoryBankStore } from '../../../src/adapters/memory/memoryBank.js';
import {
  PAGINATION_ENTRIES,
  PAGINATION_IDENTITY,
  type PaginationHarness,
} from './listPagination.js';
const unsupported = async (): Promise<never> => {
  throw new Error('Operation outside this read-pagination fixture');
};

export const managedPagination: readonly PaginationHarness[] = [
  {
    name: 'RedisStore (fake key/set client)',
    maximumReturnedPage: 1000,
    async create() {
      const values = new Map<string, string>();
      const indexes = new Map<string, Set<string>>();
      const client: RedisLikeClient = {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
          return 'OK';
        },
        sadd: async (key, ...members) => {
          const held = indexes.get(key) ?? new Set<string>();
          const before = held.size;
          members.forEach((member) => held.add(member));
          indexes.set(key, held);
          return held.size - before;
        },
        smembers: async (key) => [...(indexes.get(key) ?? [])],
        del: unsupported,
        srem: unsupported,
        sismember: unsupported,
        hgetall: unsupported,
        hset: unsupported,
        scan: unsupported,
        eval: unsupported,
        pipeline() {
          const operations: Array<() => Promise<unknown>> = [];
          const pipe: RedisLikePipeline = {
            set(key, value, ...args) {
              operations.push(() => client.set(key, value, ...args));
              return pipe;
            },
            sadd(key, ...members) {
              operations.push(() => client.sadd(key, ...members));
              return pipe;
            },
            async exec() {
              for (const operation of operations) await operation();
              return [];
            },
          };
          return pipe;
        },
        quit: async () => 'OK',
      };
      const store = new RedisStore({ _client: client });
      await store.putMany(PAGINATION_IDENTITY, PAGINATION_ENTRIES);
      return { store };
    },
  },
  {
    name: 'MemoryBankStore (fake retrieve API capped at 100)',
    maximumReturnedPage: 100,
    async create() {
      const scope = {
        tenant: PAGINATION_IDENTITY.tenant,
        principal: PAGINATION_IDENTITY.principal,
        conversation: PAGINATION_IDENTITY.conversationId,
      };
      const rows = PAGINATION_ENTRIES.map((entry) => ({
        memory: {
          name: `projects/fixture/locations/us-central1/reasoningEngines/fixture-engine/memories/${entry.id}`,
          fact: JSON.stringify(entry.value),
          scope,
          metadata: {
            agentfootprint_id: { stringValue: entry.id },
            agentfootprint_version: { doubleValue: 1 },
            agentfootprint_created_at: { doubleValue: entry.createdAt },
            agentfootprint_updated_at: { doubleValue: entry.updatedAt },
            agentfootprint_json: { boolValue: true },
          },
        },
      }));
      const retrieve = async (params: {
        requestBody: {
          scope: Record<string, string>;
          simpleRetrievalParams: { pageSize: number; pageToken?: string };
        };
      }) => {
        const request = params.requestBody;
        if (JSON.stringify(request.scope) !== JSON.stringify(scope))
          return { data: { retrievedMemories: [] } };
        const size = request.simpleRetrievalParams.pageSize;
        if (!Number.isInteger(size) || size < 1 || size > 100)
          throw new RangeError('MemoryBank fixture requires pageSize 1..100');
        const start = Number(request.simpleRetrievalParams.pageToken ?? 0);
        const retrievedMemories = rows.slice(start, start + size);
        const end = start + retrievedMemories.length;
        return {
          data: { retrievedMemories, ...(end < rows.length && { nextPageToken: String(end) }) },
        };
      };
      const client = {
        projects: { locations: { reasoningEngines: { sessions: {}, memories: { retrieve } } } },
      };
      return {
        store: memoryBankStore({
          project: 'fixture',
          location: 'us-central1',
          reasoningEngine: 'fixture-engine',
          _client: client as never,
        }),
      };
    },
  },
];
