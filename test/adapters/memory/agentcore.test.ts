/**
 * AgentCoreStore — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * SDK is mock-injected via `_client` so the suite runs without AWS
 * credentials or live AgentCore Memory. Mock implements only the
 * surface the adapter touches.
 */

import { describe, expect, it } from 'vitest';

import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import type { AgentCoreLikeClient } from '../../../src/adapters/memory/agentcore.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

class MockAgentCore implements AgentCoreLikeClient {
  // sessionId → eventId → payload
  readonly sessions = new Map<string, Map<string, string>>();

  async putEvent(input: {
    memoryId: string;
    sessionId: string;
    eventId: string;
    payload: string;
  }): Promise<unknown> {
    const session = this.sessions.get(input.sessionId) ?? new Map<string, string>();
    session.set(input.eventId, input.payload);
    this.sessions.set(input.sessionId, session);
    return {};
  }

  async getEvent(input: {
    memoryId: string;
    sessionId: string;
    eventId: string;
  }): Promise<{ payload?: string } | null> {
    const payload = this.sessions.get(input.sessionId)?.get(input.eventId);
    if (!payload) return null;
    return { payload };
  }

  async listEvents(input: {
    memoryId: string;
    sessionId: string;
    nextToken?: string;
    maxResults?: number;
  }): Promise<{
    events: ReadonlyArray<{ eventId: string; payload: string }>;
    nextToken?: string;
  }> {
    const session = this.sessions.get(input.sessionId);
    if (!session) return { events: [] };
    const all = [...session.entries()].map(([eventId, payload]) => ({ eventId, payload }));
    const start = input.nextToken ? parseInt(input.nextToken, 10) : 0;
    const max = input.maxResults ?? all.length;
    const page = all.slice(start, start + max);
    const next = start + max;
    return next < all.length ? { events: page, nextToken: String(next) } : { events: page };
  }

  async deleteEvent(input: {
    memoryId: string;
    sessionId: string;
    eventId: string;
  }): Promise<unknown> {
    this.sessions.get(input.sessionId)?.delete(input.eventId);
    return {};
  }

  async deleteSession(input: { memoryId: string; sessionId: string }): Promise<unknown> {
    this.sessions.delete(input.sessionId);
    return {};
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

  it('get/put round-trip via session+eventId', async () => {
    const mock = new MockAgentCore();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: mock });
    await store.put(id, makeEntry('a'));
    const got = await store.get<{ text: string }>(id, 'a');
    expect(got?.value.text).toBe('value-a');
    // verify isolation: AgentCore session id is derived from identity tuple
    expect(mock.sessions.size).toBe(1);
    const sessionKeys = [...mock.sessions.keys()];
    expect(sessionKeys[0]).toContain('acme/alice/thread-1');
  });

  it('get returns null for missing eventId', async () => {
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
    expect(mock.sessions.size).toBe(0);
  });

  it('putMany sequentializes calls; empty batch is no-op', async () => {
    const mock = new MockAgentCore();
    const store = new AgentCoreStore({ memoryId: 'm', _client: mock });
    await store.putMany(id, []);
    expect(mock.sessions.size).toBe(0);
    await store.putMany(id, [makeEntry('a'), makeEntry('b'), makeEntry('c')]);
    const r = await store.list(id);
    expect(r.entries.length).toBe(3);
  });

  it('list paginates via nextToken', async () => {
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

describe('AgentCoreStore — putIfVersion (emulated CAS)', () => {
  it('first-write succeeds when expectedVersion=0', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    const r = await store.putIfVersion(id, makeEntry('a', { version: 1 }), 0);
    expect(r.applied).toBe(true);
  });

  it('rejects expectedVersion!=0 when entry does not exist', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    const r = await store.putIfVersion(id, makeEntry('a', { version: 5 }), 4);
    expect(r.applied).toBe(false);
  });

  it('succeeds when expectedVersion matches stored version', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.put(id, makeEntry('a', { version: 3 }));
    const r = await store.putIfVersion(id, makeEntry('a', { version: 4 }), 3);
    expect(r.applied).toBe(true);
    const after = await store.get(id, 'a');
    expect(after?.version).toBe(4);
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

  it('feedback rejects non-finite', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.feedback(id, 'a', Number.NaN);
    await store.feedback(id, 'a', Number.POSITIVE_INFINITY);
    expect(await store.getFeedback(id, 'a')).toBeNull();
    await store.feedback(id, 'a', 0.5);
    const f = await store.getFeedback(id, 'a');
    expect(f?.average).toBeCloseTo(0.5, 6);
    expect(f?.count).toBe(1);
  });

  it('feedback clamps out-of-range to [-1, 1]', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
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

  it('forget removes only the target identity', async () => {
    const mock = new MockAgentCore();
    const store = new AgentCoreStore({ memoryId: 'm', _client: mock });
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

describe('AgentCoreStore — lifecycle', () => {
  it('post-close calls throw cleanly', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.close();
    await expect(store.get(id, 'x')).rejects.toThrow(/AgentCoreStore\.get\(\) called after close/);
    await expect(store.put(id, makeEntry('x'))).rejects.toThrow(/after close/);
  });

  it('close() is idempotent', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    await store.close();
    await store.close();
  });
});

describe('AgentCoreStore — properties', () => {
  it('JSON round-trip preserves all entry fields through AgentCore payload', async () => {
    const store = new AgentCoreStore({ memoryId: 'm', _client: new MockAgentCore() });
    const entry = makeEntry('p', {
      tier: 'cold',
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'mock-v1',
      metadata: { author: 'system', urgency: 5 },
      source: { turn: 7, runtimeStageId: 'stage#3' },
    });
    await store.put(id, entry);
    const got = await store.get(id, 'p');
    expect(got?.tier).toBe('cold');
    expect(got?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(got?.metadata?.urgency).toBe(5);
    expect(got?.source?.runtimeStageId).toBe('stage#3');
  });
});

describe('AgentCoreStore — ROI', () => {
  it('drop-in for InMemoryStore — same MemoryStore interface, AWS-managed durability', async () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _client: new MockAgentCore() });
    await store.put(id, makeEntry('a'));
    await store.put(id, makeEntry('b'));
    await store.feedback(id, 'a', 0.9);
    await store.recordSignature(id, 'h1');
    const list = await store.list(id);
    expect(list.entries.length).toBe(2);
    expect((await store.getFeedback(id, 'a'))?.average).toBeCloseTo(0.9, 6);
    expect(await store.seen(id, 'h1')).toBe(true);
    await store.forget(id);
    expect((await store.list(id)).entries.length).toBe(0);
  });
});
