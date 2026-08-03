/**
 * AgentCoreStore.search() — server-side semantic retrieval, and the mismatch it
 * had to be honest about.
 *
 * The `MemoryStore` port declares `search?(identity, vector, options?)`, because
 * the reference backends rank locally by cosine. AgentCore does not work that
 * way: it embeds and ranks on its own side and `RetrieveMemoryRecords` takes a
 * TEXT query, so the vector is the one thing it cannot use. The adapter
 * therefore reads `options.text` and REFUSES BY NAME without it — the tests
 * below pin that refusal, because the alternative (returning `[]`) reads as "no
 * matches" when it really means "wrong query form", and that is the kind of
 * wrong answer nobody investigates.
 *
 * **Contract-mapped and injection-tested.** Every AWS interaction runs through
 * the `_client` / `_sdk` seams; nothing here reaches AWS and nothing pretends
 * to. Real-cloud verification lands with a field deployment.
 */

import { describe, expect, it } from 'vitest';

import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type {
  AgentCoreEvent,
  AgentCoreLikeClient,
  AgentCoreMemoryRecord,
  BedrockAgentCoreSdkModule,
} from '../../../src/adapters/memory/agentcore.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const identity: MemoryIdentity = {
  tenant: 'acme',
  principal: 'ada',
  conversationId: 'c-1',
};

const VECTOR = [0.1, 0.2, 0.3];

/** A client that only knows how to retrieve — the rest is exercised elsewhere. */
function retrievingClient(
  records: readonly AgentCoreMemoryRecord[],
): AgentCoreLikeClient & { readonly asked: Record<string, unknown>[] } {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    createEvent: async () => undefined,
    listEvents: async (): Promise<{ events: readonly AgentCoreEvent[] }> => ({ events: [] }),
    deleteEvent: async () => undefined,
    retrieveRecords: async (input) => {
      asked.push({ ...input });
      return { records };
    },
  };
}

function record(over: Partial<AgentCoreMemoryRecord> = {}): AgentCoreMemoryRecord {
  return {
    memoryRecordId: 'rec-1',
    content: 'Ada prefers window seats.',
    score: 0.9,
    ...over,
  };
}

// ── unit: the port question the brief asked us to verify ────────────

describe('AgentCoreStore.search — the port', () => {
  it('is declared on the store, so feature detection finds it', () => {
    // The port declares `search?()` and this adapter now implements it. Callers
    // feature-detect with `if (store.search)`, and that answer must be true.
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([]) });
    expect(typeof store.search).toBe('function');
  });
});

// ── security / honesty: the text-vs-vector mismatch, said out loud ──

describe('AgentCoreStore.search — refuses the wrong query form', () => {
  it('throws a corrective error when only a vector is supplied', async () => {
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([record()]) });
    await expect(store.search(identity, VECTOR)).rejects.toThrow(/options\.text/);
  });

  it('the refusal explains WHY and how to fix it in one line', async () => {
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([]) });
    const error = await store.search(identity, VECTOR).catch((e: unknown) => e as Error);
    expect(error.message).toContain('server-side');
    expect(error.message).toContain('store.search(identity, vector, { text:');
    // And it says that passing both is always safe, so the fix is not "stop
    // using every other backend".
    expect(error.message).toContain('ignore `text`');
  });

  it('an empty or whitespace-only text is treated as absent', async () => {
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([]) });
    await expect(store.search(identity, VECTOR, { text: '   ' })).rejects.toThrow(/options\.text/);
  });

  it('does NOT quietly return [] — the failure that looks like "no matches"', async () => {
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([record()]) });
    const outcome = await store.search(identity, VECTOR).then(
      () => 'resolved',
      () => 'rejected',
    );
    expect(outcome).toBe('rejected');
  });

  it('names the missing capability when an injected client cannot retrieve', async () => {
    const store = new AgentCoreStore({
      memoryId: 'm-1',
      _client: {
        createEvent: async () => undefined,
        listEvents: async () => ({ events: [] }),
        deleteEvent: async () => undefined,
      },
    });
    await expect(store.search(identity, VECTOR, { text: 'seats' })).rejects.toThrow(
      /retrieveRecords/,
    );
  });

  it('refuses after close(), like every other method', async () => {
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([]) });
    await store.close();
    await expect(store.search(identity, VECTOR, { text: 'seats' })).rejects.toThrow(
      /called after close/,
    );
  });
});

// ── scenario: retrieval, when the query is in a form it can use ─────

describe('AgentCoreStore.search — retrieval', () => {
  it('sends the text to AgentCore and returns what it scored', async () => {
    const client = retrievingClient([record()]);
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: client });
    const results = await store.search(identity, VECTOR, { text: 'where does Ada sit?' });
    expect(client.asked[0]).toMatchObject({
      memoryId: 'm-1',
      searchQuery: 'where does Ada sit?',
    });
    expect(results).toHaveLength(1);
    expect(results[0].entry.value).toBe('Ada prefers window seats.');
    expect(results[0].score).toBe(0.9);
  });

  it('scopes the search to the identity, so one tenant never reads another', async () => {
    const client = retrievingClient([]);
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: client });
    await store.search(identity, VECTOR, { text: 'x' });
    const namespace = client.asked[0].namespace as string;
    // Identity is the first argument on every port method for exactly this
    // reason — a wrong identity must read as "no data", never as someone else's.
    expect(namespace).toContain('afp-acme_ada');
    expect(namespace).toContain('afp-c-1');
  });

  it('takes a namespace resolver when the deployment organises records differently', async () => {
    const client = retrievingClient([]);
    const store = new AgentCoreStore({
      memoryId: 'm-1',
      _client: client,
      searchNamespace: ({ actorId }) => `/strategies/semantic/actors/${actorId}`,
    });
    await store.search(identity, VECTOR, { text: 'x' });
    expect(client.asked[0].namespace).toBe('/strategies/semantic/actors/afp-acme_ada');
  });

  it('passes the strategy id through as the server-side metadata filter', async () => {
    const client = retrievingClient([]);
    const store = new AgentCoreStore({
      memoryId: 'm-1',
      _client: client,
      searchStrategyId: 'user-preference',
    });
    await store.search(identity, VECTOR, { text: 'x' });
    expect(client.asked[0].memoryStrategyId).toBe('user-preference');
  });

  it('omits the strategy filter entirely when none is configured', async () => {
    const client = retrievingClient([]);
    await new AgentCoreStore({ memoryId: 'm-1', _client: client }).search(identity, VECTOR, {
      text: 'x',
    });
    expect(client.asked[0]).not.toHaveProperty('memoryStrategyId');
  });

  it('asks for k records and returns at most k', async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      record({ memoryRecordId: `rec-${i}`, score: 1 - i / 10 }),
    );
    const client = retrievingClient(many);
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: client });
    const results = await store.search(identity, VECTOR, { text: 'x', k: 2 });
    expect(client.asked[0].maxResults).toBe(2);
    expect(results).toHaveLength(2);
  });

  it('applies minScore to what comes back', async () => {
    const client = retrievingClient([
      record({ memoryRecordId: 'high', score: 0.9 }),
      record({ memoryRecordId: 'low', score: 0.1 }),
    ]);
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: client });
    const results = await store.search(identity, VECTOR, { text: 'x', minScore: 0.5 });
    expect(results.map((r) => r.entry.id)).toEqual(['high']);
  });

  it('a tier filter excludes everything, because records carry no tier', async () => {
    // Silently ignoring a filter the caller asked for would hand back entries
    // they explicitly excluded. Returning nothing is the honest answer.
    const client = retrievingClient([record()]);
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: client });
    expect(await store.search(identity, VECTOR, { text: 'x', tiers: ['hot'] })).toEqual([]);
  });

  it('returns descending by score even if the service reorders', async () => {
    const client = retrievingClient([
      record({ memoryRecordId: 'b', score: 0.3 }),
      record({ memoryRecordId: 'a', score: 0.8 }),
    ]);
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: client });
    const results = await store.search(identity, VECTOR, { text: 'x' });
    expect(results.map((r) => r.entry.id)).toEqual(['a', 'b']);
  });

  it('a record with no score sorts as zero rather than as undefined', async () => {
    const client = retrievingClient([
      record({ memoryRecordId: 'unscored', score: undefined }),
      record({ memoryRecordId: 'scored', score: 0.5 }),
    ]);
    const results = await new AgentCoreStore({ memoryId: 'm-1', _client: client }).search(
      identity,
      VECTOR,
      { text: 'x' },
    );
    expect(results.map((r) => r.entry.id)).toEqual(['scored', 'unscored']);
  });

  it('marks results as records rather than as entries this store wrote', async () => {
    const client = retrievingClient([record({ memoryStrategyId: 'semantic' })]);
    const results = await new AgentCoreStore({ memoryId: 'm-1', _client: client }).search(
      identity,
      VECTOR,
      { text: 'x' },
    );
    // These ids belong to AgentCore, not to anything `put()` created —
    // `store.get(id)` will not find them, and the metadata says so plainly.
    expect(results[0].entry.metadata).toMatchObject({
      source: 'agentcore-memory-record',
      memoryStrategyId: 'semantic',
    });
  });

  it('no results is an empty list, not an error', async () => {
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([]) });
    expect(await store.search(identity, VECTOR, { text: 'nothing matches' })).toEqual([]);
  });
});

// ── the SDK mapping, with a fake SDK module ─────────────────────────

describe('AgentCoreStore.search — the SDK mapping', () => {
  function fakeSdk(result: unknown) {
    const sent: { command: string; input: Record<string, unknown> }[] = [];
    const command = (name: string) =>
      class {
        readonly __name = name;
        constructor(readonly input: Record<string, unknown>) {}
      };
    const module: BedrockAgentCoreSdkModule = {
      BedrockAgentCoreClient: class {
        constructor(readonly config: { region?: string }) {}
        async send(cmd: unknown): Promise<unknown> {
          const typed = cmd as { __name: string; input: Record<string, unknown> };
          sent.push({ command: typed.__name, input: typed.input });
          return result;
        }
      } as unknown as BedrockAgentCoreSdkModule['BedrockAgentCoreClient'],
      CreateEventCommand: command('CreateEvent') as never,
      ListEventsCommand: command('ListEvents') as never,
      DeleteEventCommand: command('DeleteEvent') as never,
      RetrieveMemoryRecordsCommand: command('RetrieveMemoryRecords') as never,
    };
    return { module, sent };
  }

  it('dispatches RetrieveMemoryRecords with the query under searchCriteria', async () => {
    const { module, sent } = fakeSdk({
      memoryRecordSummaries: [
        { memoryRecordId: 'r-1', content: { text: 'window seats' }, score: 0.7 },
      ],
    });
    const store = new AgentCoreStore({ memoryId: 'm-1', region: 'us-west-2', _sdk: module });
    const results = await store.search(identity, VECTOR, { text: 'seats', k: 3 });
    expect(sent[0].command).toBe('RetrieveMemoryRecords');
    expect(sent[0].input.searchCriteria).toMatchObject({ searchQuery: 'seats', topK: 3 });
    expect(results[0].entry.value).toBe('window seats');
  });

  it('reads a plain-string content field as well as the nested one', async () => {
    const { module } = fakeSdk({
      memoryRecordSummaries: [{ memoryRecordId: 'r-1', content: 'plain text', score: 0.5 }],
    });
    const store = new AgentCoreStore({ memoryId: 'm-1', _sdk: module });
    const results = await store.search(identity, VECTOR, { text: 'x' });
    expect(results[0].entry.value).toBe('plain text');
  });

  it('an empty response is an empty result set', async () => {
    const { module } = fakeSdk({});
    const store = new AgentCoreStore({ memoryId: 'm-1', _sdk: module });
    expect(await store.search(identity, VECTOR, { text: 'x' })).toEqual([]);
  });

  it('names the missing command rather than failing obscurely', async () => {
    const { module } = fakeSdk({});
    const stripped: BedrockAgentCoreSdkModule = {
      BedrockAgentCoreClient: module.BedrockAgentCoreClient!,
      CreateEventCommand: module.CreateEventCommand!,
      ListEventsCommand: module.ListEventsCommand!,
      DeleteEventCommand: module.DeleteEventCommand!,
    };
    const store = new AgentCoreStore({ memoryId: 'm-1', _sdk: stripped });
    await expect(store.search(identity, VECTOR, { text: 'x' })).rejects.toThrow(
      /RetrieveMemoryRecordsCommand/,
    );
  });
});

// ── ROI: nothing else about the store changed ───────────────────────

describe('AgentCoreStore — the rest of the store is untouched', () => {
  it('still has no stream() — no such method exists on the port', () => {
    // AgentCore Memory has no streaming data-plane operation and `MemoryStore`
    // has no streaming method. Inventing one for a single backend is how a port
    // stops being a port, so this is deliberately absent.
    const store = new AgentCoreStore({ memoryId: 'm-1', _client: retrievingClient([]) });
    expect((store as unknown as { stream?: unknown }).stream).toBeUndefined();
  });

  it('put/list keep working with a client that predates retrieveRecords', async () => {
    const events: AgentCoreEvent[] = [];
    const store = new AgentCoreStore({
      memoryId: 'm-1',
      _client: {
        createEvent: async ({ entry }) => {
          events.push({ eventId: `e-${events.length}`, entry });
        },
        listEvents: async () => ({ events }),
        deleteEvent: async () => undefined,
      },
    });
    await store.put(identity, {
      id: 'x',
      value: 'v',
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      accessCount: 0,
    });
    expect((await store.list(identity)).entries).toHaveLength(1);
  });
});
