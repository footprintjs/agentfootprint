import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type {
  AgentCoreEvent,
  AgentCoreLikeClient,
} from '../../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import {
  PAGINATION_ENTRIES,
  PAGINATION_IDENTITY,
  type PaginationHarness,
} from './listPagination.js';

/** A service-boundary fake: rejects out-of-range API input instead of forgiving it. */
export const agentCorePagination: PaginationHarness = {
  name: 'AgentCoreStore (fake service rejects ListEvents maxResults above 100)',
  supportsSearch: true,
  maximumReturnedPage: 100,
  async create() {
    const sessions = new Map<string, AgentCoreEvent[]>();
    let nextId = 0;
    let backendCalls = 0;
    const key = (actor: string, session: string) => JSON.stringify([actor, session]);
    const client: AgentCoreLikeClient = {
      async createEvent(input: { actorId: string; sessionId: string; entry: MemoryEntry }) {
        backendCalls += 1;
        const address = key(input.actorId, input.sessionId);
        const events = sessions.get(address) ?? [];
        events.push({ eventId: `event-${nextId++}`, entry: input.entry });
        sessions.set(address, events);
      },
      async listEvents(input) {
        backendCalls += 1;
        const size = input.maxResults ?? 100;
        if (!Number.isInteger(size) || size < 1 || size > 100) {
          throw new RangeError('ListEvents maxResults must be an integer from 1 through 100');
        }
        const rows = sessions.get(key(input.actorId, input.sessionId)) ?? [];
        const start = input.nextToken === undefined ? 0 : Number(input.nextToken);
        const events = rows.slice(start, start + size);
        const end = start + events.length;
        return { events, ...(end < rows.length && { nextToken: String(end) }) };
      },
      async deleteEvent() {
        throw new Error('This pagination fixture does not exercise deletion');
      },
      async retrieveRecords(input) {
        backendCalls += 1;
        const size = input.maxResults;
        if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 100)
          throw new RangeError('RetrieveMemoryRecords fixture requires maxResults 1..100');
        return { records: [] };
      },
    };
    const store = new AgentCoreStore({ memoryId: 'pagination-memory', _client: client });
    await store.putMany(PAGINATION_IDENTITY, PAGINATION_ENTRIES);
    return { store, backendCalls: () => backendCalls };
  },
};
