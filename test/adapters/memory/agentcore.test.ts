/**
 * AgentCoreStore — tests against the AgentCore **event** model
 * (`@aws-sdk/client-bedrock-agentcore`: CreateEvent / ListEvents / DeleteEvent).
 *
 * Two layers:
 *  1. Store behaviour — a mock `AgentCoreLikeClient` (entry-semantic) exercises
 *     put/get/list/delete/forget/CAS/feedback without AWS.
 *  2. SDK-shim regression guard — a mock SDK module (`_sdk`) asserts the adapter
 *     dispatches the REAL AgentCore commands with the right inputs, so the
 *     wrong-service bug (it used to target `bedrock-agent-runtime` with
 *     non-existent `PutMemoryEventCommand`s) can never recur silently.
 */

import { describe, expect, it } from 'vitest';

import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type {
  AgentCoreEvent,
  AgentCoreLikeClient,
} from '../../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

/** In-memory mock of the entry-semantic client: append-log keyed by actor+session. */
class MockAgentCore implements AgentCoreLikeClient {
  readonly log = new Map<string, { eventId: string; entry: MemoryEntry }[]>();
  private seq = 0;
  private key(actorId: string, sessionId: string): string {
    return `${actorId}|${sessionId}`;
  }
  async createEvent(input: {
    actorId: string;
    sessionId: string;
    entry: MemoryEntry;
  }): Promise<void> {
    const k = this.key(input.actorId, input.sessionId);
    const arr = this.log.get(k) ?? [];
    arr.push({ eventId: `ev-${this.seq++}`, entry: input.entry });
    this.log.set(k, arr);
  }
  async listEvents(input: {
    actorId: string;
    sessionId: string;
    maxResults?: number;
    nextToken?: string;
  }): Promise<{ events: readonly AgentCoreEvent[]; nextToken?: string }> {
    const arr = this.log.get(this.key(input.actorId, input.sessionId)) ?? [];
    const start = input.nextToken ? parseInt(input.nextToken, 10) : 0;
    const max = input.maxResults ?? arr.length;
    const page = arr.slice(start, start + max);
    const next = start + max;
    return next < arr.length ? { events: page, nextToken: String(next) } : { events: page };
  }
  async deleteEvent(input: { actorId: string; sessionId: string; eventId: string }): Promise<void> {
    const k = this.key(input.actorId, input.sessionId);
    const arr = this.log.get(k);
    if (arr)
      this.log.set(
        k,
        arr.filter((e) => e.eventId !== input.eventId),
      );
  }
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

describe('AgentCoreStore — unit (basics)', () => {
  it('throws when constructed without memoryId', () => {
    expect(() => new AgentCoreStore({ memoryId: '' })).toThrow(/requires `memoryId`/);
  });

  it('put then get round-trips (list-then-find by entry id)', async () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: new MockAgentCore() });
    await store.put(id, makeEntry('a'));
    const got = await store.get<{ text: string }>(id, 'a');
    expect(got?.value.text).toBe('value-a');
  });

  it('get returns null for a missing id', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    expect(await store.get(id, 'nope')).toBeNull();
  });

  it('TTL: get returns null after entry expires', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('e', { ttl: Date.now() + 50 }));
    expect(await store.get(id, 'e')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(await store.get(id, 'e')).toBeNull();
  });

  it('TTL=0 (already expired) refuses to write', async () => {
    const mock = new MockAgentCore();
    const store = new AgentCoreStore({ memoryId: 'm', _client: mock });
    await store.put(id, makeEntry('e', { ttl: Date.now() - 1 }));
    expect(mock.log.size).toBe(0);
  });

  it('putMany sequentializes; empty batch is a no-op', async () => {
    const mock = new MockAgentCore();
    const store = new AgentCoreStore({ memoryId: 'm', _client: mock });
    await store.putMany(id, []);
    expect(mock.log.size).toBe(0);
    await store.putMany(id, [makeEntry('a'), makeEntry('b'), makeEntry('c')]);
    expect((await store.list(id)).entries.length).toBe(3);
  });

  it('list paginates via nextToken/cursor', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
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
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('h', { tier: 'hot' }));
    await store.put(id, makeEntry('w', { tier: 'warm' }));
    const r = await store.list(id, { tiers: ['hot'] });
    expect(r.entries.map((e) => e.id)).toEqual(['h']);
  });

  it('delete removes the event + clears feedback shadow state', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('a'));
    await store.feedback(id, 'a', 0.7);
    await store.delete(id, 'a');
    expect(await store.get(id, 'a')).toBeNull();
    expect(await store.getFeedback(id, 'a')).toBeNull();
  });
});

describe('AgentCoreStore — SDK shim (regression guard: REAL AgentCore commands)', () => {
  function spySdk() {
    const sent: { cmd: string; input: Record<string, unknown> }[] = [];
    const cmd = (name: string) =>
      class {
        static cmdName = name;
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) {
          this.input = input;
        }
      };
    const sdk = {
      BedrockAgentCoreClient: class {
        constructor(public config: { region?: string }) {}
        async send(c: { constructor: { cmdName: string }; input: Record<string, unknown> }) {
          sent.push({ cmd: c.constructor.cmdName, input: c.input });
          return c.constructor.cmdName === 'ListEvents' ? { events: [] } : {};
        }
      },
      CreateEventCommand: cmd('CreateEvent'),
      ListEventsCommand: cmd('ListEvents'),
      DeleteEventCommand: cmd('DeleteEvent'),
    };
    return { sdk, sent };
  }

  it('put → CreateEventCommand with memoryId/actorId/sessionId/eventTimestamp + entry as a blob payload', async () => {
    const { sdk, sent } = spySdk();
    const store = new AgentCoreStore({
      memoryId: 'mem-1',
      region: 'us-west-2',
      _sdk: sdk as never,
    });
    await store.put(id, makeEntry('a'));
    const create = sent.find((s) => s.cmd === 'CreateEvent');
    expect(
      create,
      'must dispatch CreateEventCommand (not the old PutMemoryEventCommand)',
    ).toBeDefined();
    expect(create!.input.memoryId).toBe('mem-1');
    expect(String(create!.input.actorId)).toMatch(/^afp-/);
    expect(String(create!.input.sessionId)).toMatch(/^afp-/);
    expect(create!.input.eventTimestamp).toBeInstanceOf(Date);
    const payload = create!.input.payload as { blob?: MemoryEntry }[];
    expect(payload[0].blob?.id).toBe('a');
  });

  it('list → ListEventsCommand with includePayloads', async () => {
    const { sdk, sent } = spySdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    await store.list(id);
    const list = sent.find((s) => s.cmd === 'ListEvents');
    expect(list).toBeDefined();
    expect(list!.input.includePayloads).toBe(true);
  });

  it('throws a clear error naming the correct peer when the SDK lacks the client', () => {
    expect(() => new AgentCoreStore({ memoryId: 'm', _sdk: {} as never })).toThrow(
      /BedrockAgentCoreClient/,
    );
  });
});

describe('AgentCoreStore — putIfVersion (emulated CAS)', () => {
  it('first-write succeeds when expectedVersion=0', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    expect((await store.putIfVersion(id, makeEntry('a', { version: 1 }), 0)).applied).toBe(true);
  });
  it('rejects expectedVersion!=0 when entry does not exist', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    expect((await store.putIfVersion(id, makeEntry('a', { version: 5 }), 4)).applied).toBe(false);
  });
  it('succeeds when expectedVersion matches stored version', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('a', { version: 3 }));
    const r = await store.putIfVersion(id, makeEntry('a', { version: 4 }), 3);
    expect(r.applied).toBe(true);
    expect((await store.get(id, 'a'))?.version).toBe(4);
  });
  it('rejects + returns currentVersion on stale CAS', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('a', { version: 5 }));
    const r = await store.putIfVersion(id, makeEntry('a', { version: 6 }), 3);
    expect(r.applied).toBe(false);
    expect(r.currentVersion).toBe(5);
  });
});

describe('AgentCoreStore — signatures + feedback (in-process shadow)', () => {
  it('seen/recordSignature round-trip', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    expect(await store.seen(id, 'hash-1')).toBe(false);
    await store.recordSignature(id, 'hash-1');
    expect(await store.seen(id, 'hash-1')).toBe(true);
  });
  it('feedback rejects non-finite + clamps to [-1,1]', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.feedback(id, 'a', Number.NaN);
    expect(await store.getFeedback(id, 'a')).toBeNull();
    await store.feedback(id, 'a', 9.9);
    await store.feedback(id, 'a', -9.9);
    const f = await store.getFeedback(id, 'a');
    expect(f?.average).toBeCloseTo(0, 6);
    expect(f?.count).toBe(2);
  });
});

describe('AgentCoreStore — multi-tenant isolation', () => {
  it('writes under tenant A do not appear under tenant B', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('shared'));
    expect(await store.get(id2, 'shared')).toBeNull();
    expect(await store.get(id, 'shared')).not.toBeNull();
  });
  it('forget removes only the target identity (list + delete each, no DeleteSession)', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
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
});

describe('AgentCoreStore — lifecycle + properties', () => {
  it('post-close calls throw cleanly; close() is idempotent', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.close();
    await store.close();
    await expect(store.get(id, 'x')).rejects.toThrow(/called after close/);
  });
  it('preserves all entry fields through the blob payload', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(
      id,
      makeEntry('p', {
        tier: 'cold',
        embedding: [0.1, 0.2, 0.3],
        metadata: { author: 'system', urgency: 5 },
        source: { turn: 7, runtimeStageId: 'stage#3' },
      }),
    );
    const got = await store.get(id, 'p');
    expect(got?.tier).toBe('cold');
    expect(got?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(got?.metadata?.urgency).toBe(5);
    expect(got?.source?.runtimeStageId).toBe('stage#3');
  });
});
