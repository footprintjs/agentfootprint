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
 *
 * Since 7.22.1 the shim also carries the twin of a field-reproduced session
 * defect: an entry written as an OBJECT comes back as this service's own
 * `toString()` rendering and decodes to nothing, so entries are written as JSON
 * TEXT and a blob that is present but unreadable is refused BY NAME rather than
 * skipped. The mangled shape is pinned as a fixture, and the old reader's silent
 * skip is pinned beside it as the contrast.
 */

import { describe, expect, it } from 'vitest';

import {
  AgentCoreStore,
  UnreadableMemoryEntryError,
} from '../../../src/adapters/memory/agentcore.js';
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

  it('put → CreateEventCommand with memoryId/actorId/sessionId/eventTimestamp + the entry as JSON TEXT', async () => {
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

    // THE FIX (7.22.1). A raw object here is what the session store lost
    // conversations to: the service stores its own host language's toString()
    // of an object it is handed and returns a string nothing can decode. Text
    // goes out, the same text comes back.
    const payload = create!.input.payload as { blob?: unknown }[];
    expect(typeof payload[0].blob).toBe('string');
    expect((JSON.parse(payload[0].blob as string) as MemoryEntry).id).toBe('a');
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

// ── the twin of the session defect: a mangled blob ──────────────────
//
// The session store shipped this same pattern — an OBJECT written as an event
// blob — and a field deployment proved what the service does with it: it stores
// its own host language's `toString()` rendering and returns `{id=m-1,
// value={...}}`, which is not JSON and is lossy. The reader accepted objects
// only, so every entry decoded to null and was SKIPPED: `list()` came back
// short, `get()` came back null, and an agent answered as if it had never been
// told. Memory that silently stays empty is indistinguishable from memory that
// works, until somebody notices the assistant forgot a customer's address.
//
// `MemoryStore` has no envelope and no shared reading path — there is no
// `readFormat` on this port to inherit a law from — so the refusal lives at this
// adapter's decode step, with the same capped preview the session refusal uses.

describe('AgentCoreStore — an unreadable entry', () => {
  /** What the service returns for an entry that was written as an object. */
  const MANGLED_BLOB =
    '{id=a, value={text=her home address is 14 Rowan Street}, version=1, ' +
    'createdAt=1754000000000, tier=hot}';

  /**
   * A stateful SDK stand-in: `CreateEvent` keeps the blob it was handed and
   * `ListEvents` gives it back, which is the only way a round trip is a round
   * trip. `listBlobs` replaces the stored blobs wholesale, for bytes this
   * adapter never wrote.
   */
  function statefulSdk(listBlobs?: readonly unknown[]) {
    const written: unknown[] = [];
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
          const name = c.constructor.cmdName;
          if (name === 'CreateEvent') {
            written.push((c.input.payload as { blob: unknown }[])[0].blob);
            return {};
          }
          if (name === 'ListEvents') {
            const blobs = listBlobs ?? written;
            return {
              events: blobs.map((blob, index) => ({
                eventId: `ev-${index}`,
                payload: [{ blob }],
              })),
            };
          }
          if (name === 'RetrieveMemoryRecords') {
            return {
              memoryRecordSummaries: [
                { memoryRecordId: 'rec-1', content: 'Ada prefers window seats.', score: 0.9 },
              ],
            };
          }
          return {};
        }
      },
      CreateEventCommand: cmd('CreateEvent'),
      ListEventsCommand: cmd('ListEvents'),
      DeleteEventCommand: cmd('DeleteEvent'),
      RetrieveMemoryRecordsCommand: cmd('RetrieveMemoryRecords'),
    };
    return { sdk, written };
  }

  it('is what the OLD reader silently skipped — pinned as the contrast', () => {
    // The pre-7.22.1 decode step, quoted so the regression has a shape a reader
    // can recognise rather than a description. Objects only…
    const oldEntryFromPayload = (payload: unknown): MemoryEntry | null => {
      if (!Array.isArray(payload)) return null;
      for (const p of payload) {
        const blob = (p as { blob?: unknown })?.blob;
        if (blob && typeof blob === 'object') return blob as MemoryEntry;
      }
      return null;
    };
    // …so the mangled string decoded to null…
    expect(oldEntryFromPayload([{ blob: MANGLED_BLOB }])).toBeNull();
    // …and null was dropped from the list by `list()`'s own `if (!entry) continue`,
    // which is a memory that exists reported as a memory that does not.
  });

  it('refuses LOUDLY now, naming the event and the session', async () => {
    const { sdk } = statefulSdk([MANGLED_BLOB]);
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    await expect(store.list(id)).rejects.toBeInstanceOf(UnreadableMemoryEntryError);
    await expect(store.list(id)).rejects.toThrow(/event 'ev-0'/);
    await expect(store.list(id)).rejects.toThrow(/session 'afp-/);
    await expect(store.list(id)).rejects.toThrow(/different facts/);
  });

  it('carries the code and the blob SHAPE, and quotes none of the memory', async () => {
    const { sdk } = statefulSdk([MANGLED_BLOB]);
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    const err = await store.list(id).then(
      () => undefined,
      (e: unknown) => e as UnreadableMemoryEntryError,
    );
    expect(err?.code).toBe('ERR_UNREADABLE_MEMORY_ENTRY');
    expect(err?.eventId).toBe('ev-0');
    expect(err?.sessionId).toMatch(/^afp-/);
    // Enough to recognise the mangling: it is a long string, it is not JSON,
    // and it opens like something that stringified an object.
    expect(err?.storedShape).toBe(
      `a ${MANGLED_BLOB.length}-character string that is not JSON, starting "{"`,
    );
    // NOT a prefix. A MemoryEntry's second field is `value`, so even a capped
    // quote would print what somebody asked the agent to remember.
    expect(err?.message).not.toContain('14 Rowan Street');
    expect(err?.message).not.toContain('Rowan');
    expect(err?.message).not.toContain('id=a');
    // It says plainly that pre-fix entries are not recoverable, so nobody goes
    // looking for a migration that cannot exist.
    expect(err?.message).toMatch(/before 7\.22\.1/);
  });

  it('refuses on every read path, not just list', async () => {
    const { sdk } = statefulSdk([MANGLED_BLOB]);
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    // `get`, `delete` and `forget` all walk the same events. A read that cannot
    // see a memory must not report "not there" on any of them.
    await expect(store.get(id, 'a')).rejects.toBeInstanceOf(UnreadableMemoryEntryError);
    await expect(store.delete(id, 'a')).rejects.toBeInstanceOf(UnreadableMemoryEntryError);
    await expect(store.forget(id)).rejects.toBeInstanceOf(UnreadableMemoryEntryError);
  });

  it.each([
    ['JSON that is not an object', '"just a string"'],
    ['JSON null', 'null'],
    ['a number', 7],
    ['truncated JSON', '{"id":"a","value":{'],
  ])('refuses %s the same way — present is not absent', async (_label, blob) => {
    const { sdk } = statefulSdk([blob]);
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    await expect(store.list(id)).rejects.toBeInstanceOf(UnreadableMemoryEntryError);
  });

  it.each([
    ['a payload with no blob key at all', [{ conversational: { text: 'hi' } }]],
    ['a blob key holding nothing', [{ blob: null }]],
    ['a payload that is not a list', 'not-a-list'],
  ])('%s is an ABSENCE — this store never wrote it', async (_label, payload) => {
    // AgentCore writes events of its own into the same log. Nothing in these
    // ever claimed to be one of our entries, so they are skipped rather than
    // refused — which is the distinction the whole fix rests on.
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
        async send(c: { constructor: { cmdName: string } }) {
          return c.constructor.cmdName === 'ListEvents'
            ? { events: [{ eventId: 'ev-0', payload }] }
            : {};
        }
      },
      CreateEventCommand: cmd('CreateEvent'),
      ListEventsCommand: cmd('ListEvents'),
      DeleteEventCommand: cmd('DeleteEvent'),
    };
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    expect((await store.list(id)).entries).toEqual([]);
    expect(await store.get(id, 'a')).toBeNull();
  });
});

describe('AgentCoreStore — string blobs on every read path', () => {
  function statefulSdk() {
    const written: unknown[] = [];
    const cmd = (name: string) =>
      class {
        static cmdName = name;
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) {
          this.input = input;
        }
      };
    const deleted: string[] = [];
    const sdk = {
      BedrockAgentCoreClient: class {
        constructor(public config: { region?: string }) {}
        async send(c: { constructor: { cmdName: string }; input: Record<string, unknown> }) {
          const name = c.constructor.cmdName;
          if (name === 'CreateEvent') {
            written.push((c.input.payload as { blob: unknown }[])[0].blob);
            return {};
          }
          if (name === 'ListEvents') {
            return {
              events: written.map((blob, index) => ({
                eventId: `ev-${index}`,
                payload: [{ blob }],
              })),
            };
          }
          if (name === 'DeleteEvent') {
            deleted.push(String(c.input.eventId));
            return {};
          }
          if (name === 'RetrieveMemoryRecords') {
            return {
              memoryRecordSummaries: [
                { memoryRecordId: 'rec-1', content: 'Ada prefers window seats.', score: 0.9 },
              ],
            };
          }
          return {};
        }
      },
      CreateEventCommand: cmd('CreateEvent'),
      ListEventsCommand: cmd('ListEvents'),
      DeleteEventCommand: cmd('DeleteEvent'),
      RetrieveMemoryRecordsCommand: cmd('RetrieveMemoryRecords'),
    };
    return { sdk, written, deleted };
  }

  it('put → list round-trips through JSON text, with every field intact', async () => {
    const { sdk, written } = statefulSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    await store.put(
      id,
      makeEntry('p', {
        tier: 'cold',
        embedding: [0.1, 0.2, 0.3],
        metadata: { author: 'system', urgency: 5 },
        source: { turn: 7, runtimeStageId: 'stage#3' },
      }),
    );
    expect(typeof written[0]).toBe('string');
    const [entry] = (await store.list(id)).entries;
    expect(entry?.id).toBe('p');
    expect(entry?.tier).toBe('cold');
    expect(entry?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(entry?.metadata?.urgency).toBe(5);
    expect(entry?.source?.runtimeStageId).toBe('stage#3');
  });

  it('get and delete find an entry stored as text', async () => {
    const { sdk, deleted } = statefulSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    await store.put(id, makeEntry('a'));
    expect((await store.get<{ text: string }>(id, 'a'))?.value.text).toBe('value-a');
    await store.delete(id, 'a');
    expect(deleted).toEqual(['ev-0']);
  });

  it('search is unaffected — it reads records, not the blobs this store writes', async () => {
    const { sdk } = statefulSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk as never });
    await store.put(id, makeEntry('a'));
    const hits = await store.search(id, [0.1, 0.2], { text: 'where does Ada sit?' });
    expect(hits.map((h) => h.entry.value)).toEqual(['Ada prefers window seats.']);
    // …and the event-backed half still reads back beside it.
    expect((await store.list(id)).entries.map((e) => e.id)).toEqual(['a']);
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
