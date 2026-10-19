/** AgentCore's wire limits and public SDK seam — scripted commands, never AWS. */
import { describe, expect, it, vi } from 'vitest';
import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type {
  AgentCoreLikeClient,
  BedrockAgentCoreSdkModule,
} from '../../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import { resolveTurnNumber } from '../../../src/memory/turn/resolveTurnNumber.js';

const identity = { tenant: 'acme', principal: 'alice', conversationId: 'thread' };
const entry = (turn: number): MemoryEntry => ({
  id: `msg-${turn}-0`,
  value: { content: `turn ${turn}` },
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  lastAccessedAt: 1,
  accessCount: 0,
  source: { turn },
});

/** Models the service's bound; an overlarge request fails instead of hiding the bug. */
function boundedClient(size = 251) {
  const events = Array.from({ length: size }, (_, i) => ({
    eventId: `event-${i}`,
    entry: entry(i + 1),
  }));
  const listEvents = vi.fn<AgentCoreLikeClient['listEvents']>(async (input) => {
    const limit = input.maxResults ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('ValidationException: maxResults must be an integer from 1 to 100');
    }
    const start = Number(input.nextToken ?? 0);
    const end = start + limit;
    return {
      events: events.slice(start, end),
      ...(end < events.length && { nextToken: String(end) }),
    };
  });
  const client: AgentCoreLikeClient = {
    createEvent: async () => undefined,
    deleteEvent: async () => undefined,
    listEvents,
  };
  return { client, listEvents };
}

function sdkDouble() {
  class Command {
    constructor(readonly input: unknown) {}
  }
  class ListEventsCommand extends Command {}
  class RetrieveMemoryRecordsCommand extends Command {}
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ListEventsCommand) return { events: [] };
    if (command instanceof RetrieveMemoryRecordsCommand) {
      const input = command.input as { maxResults: number; searchCriteria: { topK: number } };
      for (const size of [input.maxResults, input.searchCriteria.topK]) {
        if (!Number.isInteger(size) || size < 1 || size > 100) {
          throw new Error('ValidationException: retrieval size must be an integer from 1 to 100');
        }
      }
      return { memoryRecordSummaries: [] };
    }
    return {};
  });
  const sdk: BedrockAgentCoreSdkModule = {
    BedrockAgentCoreClient: class {
      send = send;
    },
    CreateEventCommand: Command,
    DeleteEventCommand: Command,
    ListEventsCommand,
    RetrieveMemoryRecordsCommand,
  };
  return { sdk, send };
}

describe('AgentCoreStore — bounded pages and turn resolution', () => {
  it('caps a legal port request and preserves the AWS cursor to reach every page', async () => {
    const { client, listEvents } = boundedClient();
    const store = new AgentCoreStore({ memoryId: 'memory', client });
    const first = await store.list(identity, { limit: 1000 });
    expect(first.entries).toHaveLength(100);
    expect(first.cursor).toBe('100');
    const second = await store.list(identity, { limit: 1000, cursor: first.cursor });
    expect(second.entries).toHaveLength(100);
    expect(second.cursor).toBe('200');
    const last = await store.list(identity, { limit: 1000, cursor: second.cursor });
    expect(last.entries).toHaveLength(51);
    expect(last.cursor).toBeUndefined();
    expect(listEvents.mock.calls.map(([input]) => input.maxResults)).toEqual([100, 100, 100]);
  });

  it('resolves the highest stored turn after multiple capped pages', async () => {
    const { client, listEvents } = boundedClient();
    const store = new AgentCoreStore({ memoryId: 'memory', client });
    await expect(resolveTurnNumber({ stores: [store], identity, hostTurn: 1 })).resolves.toBe(252);
    expect(listEvents.mock.calls.map(([input]) => input.nextToken)).toEqual([
      undefined,
      '100',
      '200',
    ]);
  });

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses pageSize %s before it constructs an SDK client',
    (pageSize) => {
      const construct = vi.fn();
      const sdk = {
        BedrockAgentCoreClient: class {
          constructor() {
            construct();
          }
          async send() {
            return {};
          }
        },
      };
      expect(() => new AgentCoreStore({ memoryId: 'memory', pageSize, sdk })).toThrow(
        /pageSize.*integer.*1.*100/,
      );
      expect(construct).not.toHaveBeenCalled();
    },
  );

  it.each([1, 100])('accepts pageSize %s and uses it for session scans', async (pageSize) => {
    const { client, listEvents } = boundedClient(2);
    const store = new AgentCoreStore({ memoryId: 'memory', pageSize, client });
    expect(await store.get(identity, 'msg-2-0')).not.toBeNull();
    expect(listEvents.mock.calls.every(([input]) => input.maxResults === pageSize)).toBe(true);
  });

  it('keeps a smaller per-call request and uses the configured page size by default', async () => {
    const { client, listEvents } = boundedClient();
    const store = new AgentCoreStore({ memoryId: 'memory', pageSize: 50, client });
    await store.list(identity);
    await store.list(identity, { limit: 7 });
    expect(listEvents.mock.calls.map(([input]) => input.maxResults)).toEqual([50, 7]);
  });
});

describe('AgentCoreStore — public SDK injection and retrieval limits', () => {
  it('uses the public SDK module without loading the optional peer', async () => {
    const { sdk, send } = sdkDouble();
    const store = new AgentCoreStore({ memoryId: 'memory', sdk });
    await expect(store.list(identity, { limit: 1000 })).resolves.toEqual({ entries: [] });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ input: { maxResults: 100 } });
  });

  it('caps both retrieval maxResults and searchCriteria.topK on the real command path', async () => {
    const { sdk, send } = sdkDouble();
    const store = new AgentCoreStore({ memoryId: 'memory', sdk });
    await store.search(identity, [], { text: 'shipping preference', k: 1000 });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: { maxResults: 100, searchCriteria: { topK: 100 } },
    });
  });

  it('still refuses extraction options before sending when the SDK cannot model them', async () => {
    const { sdk, send } = sdkDouble();
    const store = new AgentCoreStore({ memoryId: 'memory', sdk });
    await expect(store.put(identity, entry(1), { extraction: 'skip' })).rejects.toThrow(
      /3\.1114\.0/,
    );
    expect(send).not.toHaveBeenCalled();
  });
});

const invalidCallerLimits = [0, -1, 1.5, Number.NaN, Infinity, -Infinity, null] as const;
describe('AgentCoreStore — caller limits fail locally before RPC', () => {
  it.each(invalidCallerLimits)('rejects list limit %s without calling ListEvents', async (raw) => {
    const { client, listEvents } = boundedClient();
    const store = new AgentCoreStore({ memoryId: 'memory', client });
    const failure = await store
      .list(identity, { limit: raw as number })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RangeError);
    expect((failure as Error).message).toBe(
      'MemoryStore.list(): `limit` must be a positive integer when provided.',
    );
    expect(listEvents).not.toHaveBeenCalled();
  });

  it.each(invalidCallerLimits)(
    'rejects search k %s without sending either AWS size field',
    async (raw) => {
      const { sdk, send } = sdkDouble();
      const store = new AgentCoreStore({ memoryId: 'memory', sdk });
      const failure = await store
        .search(identity, [], {
          text: 'shipping preference',
          k: raw as number,
        })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RangeError);
      expect((failure as Error).message).toBe(
        'MemoryStore.search(): `k` must be a positive integer when provided.',
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('sends the same list bound that was validated, reading a caller getter once', async () => {
    const { client, listEvents } = boundedClient();
    const store = new AgentCoreStore({ memoryId: 'memory', client });
    let reads = 0;
    await store.list(identity, {
      get limit() {
        reads++;
        return reads === 1 ? 7 : 0;
      },
    });
    expect(reads).toBe(1);
    expect(listEvents.mock.calls[0]?.[0].maxResults).toBe(7);
  });

  it('sends the same search bound that was validated, reading a caller getter once', async () => {
    const { sdk, send } = sdkDouble();
    const store = new AgentCoreStore({ memoryId: 'memory', sdk });
    let reads = 0;
    await store.search(identity, [], {
      text: 'shipping preference',
      get k() {
        reads++;
        return reads === 1 ? 7 : 0;
      },
    });
    expect(reads).toBe(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: { maxResults: 7, searchCriteria: { topK: 7 } },
    });
  });

  it('keeps undefined retrieval defaults and a positive caller bound unchanged', async () => {
    const { sdk, send } = sdkDouble();
    const store = new AgentCoreStore({ memoryId: 'memory', sdk });
    await store.search(identity, [], { text: 'shipping preference' });
    await store.search(identity, [], { text: 'shipping preference', k: 7 });
    expect(send.mock.calls.map(([command]) => command)).toMatchObject([
      { input: { maxResults: 10, searchCriteria: { topK: 10 } } },
      { input: { maxResults: 7, searchCriteria: { topK: 7 } } },
    ]);
  });
});
