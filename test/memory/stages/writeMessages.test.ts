/**
 * writeMessages stage — 5-pattern tests.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '../../../src/memory/store';
import { writeMessages } from '../../../src/memory/stages/writeMessages';
import type { MemoryState } from '../../../src/memory/stages/types';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't1', principal: 'u1', conversationId: 'c1' };

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

function makeScope(partial?: Partial<MemoryState>): MemoryState {
  return {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
    loaded: [],
    newMessages: [],
    ...partial,
  };
}

let store: InMemoryStore;
beforeEach(() => {
  store = new InMemoryStore();
});

// ── Unit ────────────────────────────────────────────────────

describe('writeMessages — unit', () => {
  it('writes each new message as a MemoryEntry', async () => {
    const scope = makeScope({
      newMessages: [msg('user', 'hi'), msg('assistant', 'hello!')],
    });
    await writeMessages({ store })(scope as never);

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(2);
  });

  it('uses default id format `msg-{turn}-{index}`', async () => {
    const scope = makeScope({
      turnNumber: 3,
      newMessages: [msg('user', 'a'), msg('assistant', 'b')],
    });
    await writeMessages({ store })(scope as never);

    expect(await store.get(ID, 'msg-3-0')).not.toBeNull();
    expect(await store.get(ID, 'msg-3-1')).not.toBeNull();
  });

  it('tags entries with source.turn + source.identity', async () => {
    const scope = makeScope({
      turnNumber: 7,
      newMessages: [msg('user', 'hi')],
    });
    await writeMessages({ store })(scope as never);

    const entry = await store.get<Message>(ID, 'msg-7-0');
    expect(entry?.source?.turn).toBe(7);
    expect(entry?.source?.identity?.conversationId).toBe('c1');
    expect(entry?.source?.identity?.tenant).toBe('t1');
  });

  it('no-op when newMessages is empty', async () => {
    const scope = makeScope({ newMessages: [] });
    await writeMessages({ store })(scope as never);
    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(0);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('writeMessages — boundary', () => {
  it('custom idFrom overrides default format', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'hi')],
    });
    await writeMessages({
      store,
      idFrom: (turn, idx, m) => `custom-${turn}-${idx}-${m.role}`,
    })(scope as never);

    expect(await store.get(ID, 'custom-1-0-user')).not.toBeNull();
  });

  it('ttlMs sets an absolute expiry in the future', async () => {
    const before = Date.now();
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'hi')],
    });
    await writeMessages({ store, ttlMs: 60_000 })(scope as never);
    const after = Date.now();

    const entry = await store.get(ID, 'msg-1-0');
    expect(entry?.ttl).toBeDefined();
    expect(entry!.ttl!).toBeGreaterThanOrEqual(before + 60_000);
    expect(entry!.ttl!).toBeLessThanOrEqual(after + 60_000);
  });

  it('tier is applied to every written entry', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'a'), msg('assistant', 'b')],
    });
    await writeMessages({ store, tier: 'hot' })(scope as never);

    const entries = (await store.list(ID)).entries;
    expect(entries.every((e) => e.tier === 'hot')).toBe(true);
  });

  it('signatureFrom registers signature when provided', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'unique-content')],
    });
    await writeMessages({
      store,
      signatureFrom: (m) => `sig:${typeof m.content === 'string' ? m.content : ''}`,
    })(scope as never);

    expect(await store.seen(ID, 'sig:unique-content')).toBe(true);
    expect(await store.seen(ID, 'sig:different')).toBe(false);
  });

  it('without signatureFrom, no signatures registered (default)', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'hi')],
    });
    await writeMessages({ store })(scope as never);
    // Whatever the caller might hash, nothing was registered
    expect(await store.seen(ID, 'sig:hi')).toBe(false);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('writeMessages — scenario', () => {
  it('re-running the same turn is idempotent (overwrites, does not grow)', async () => {
    const scope = makeScope({
      turnNumber: 5,
      newMessages: [msg('user', 'first')],
    });
    await writeMessages({ store })(scope as never);

    // Simulate a retry: same turn, same message
    await writeMessages({ store })(scope as never);

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(1); // one entry, overwritten
  });

  it('two turns accumulate into distinct entries', async () => {
    const scope1 = makeScope({ turnNumber: 1, newMessages: [msg('user', 'turn 1')] });
    await writeMessages({ store })(scope1 as never);

    const scope2 = makeScope({ turnNumber: 2, newMessages: [msg('user', 'turn 2')] });
    await writeMessages({ store })(scope2 as never);

    const listed = await store.list(ID);
    expect(listed.entries.length).toBe(2);
  });

  it('writes land in the scope identity, not elsewhere', async () => {
    const OTHER = { tenant: 't1', principal: 'u2', conversationId: 'c1' };
    const scope = makeScope({ newMessages: [msg('user', 'hi')] });
    await writeMessages({ store })(scope as never);

    // Other identity must see nothing
    expect((await store.list(OTHER)).entries.length).toBe(0);
  });
});

// ── Property ────────────────────────────────────────────────

describe('writeMessages — property', () => {
  it('number of stored entries equals number of messages (no loss)', async () => {
    for (const n of [1, 5, 20, 100]) {
      const freshStore = new InMemoryStore();
      const messages = Array.from({ length: n }, (_, i) => msg('user', `msg ${i}`));
      const scope = makeScope({ turnNumber: 1, newMessages: messages });
      await writeMessages({ store: freshStore })(scope as never);
      expect((await freshStore.list(ID)).entries.length).toBe(n);
    }
  });

  it('every written entry has version === 1 (first-write)', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')],
    });
    await writeMessages({ store })(scope as never);
    const entries = (await store.list(ID)).entries;
    expect(entries.every((e) => e.version === 1)).toBe(true);
  });

  it('first write has createdAt === updatedAt === lastAccessedAt (timestamp invariant)', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'a')],
    });
    await writeMessages({ store })(scope as never);
    // Read via list (list does not bump lastAccessedAt) to see raw timestamps
    const entries = (await store.list(ID)).entries;
    const entry = entries[0];
    expect(entry.createdAt).toBe(entry.updatedAt);
    expect(entry.updatedAt).toBe(entry.lastAccessedAt);
  });
});

// ── Security ────────────────────────────────────────────────

describe('writeMessages — security', () => {
  it('errors from store propagate (fail-loud)', async () => {
    const brokenStore = {
      put: async () => {
        throw new Error('write failed');
      },
    } as unknown as InMemoryStore;

    const scope = makeScope({ newMessages: [msg('user', 'hi')] });
    await expect(writeMessages({ store: brokenStore })(scope as never)).rejects.toThrow(
      /write failed/,
    );
  });

  it('does not carry source.identity across identities by mistake', async () => {
    // Write as ID_A, read as ID_A, confirm source.identity matches.
    const scope = makeScope({ newMessages: [msg('user', 'hi')] });
    await writeMessages({ store })(scope as never);
    const entry = await store.get<Message>(ID, 'msg-1-0');
    expect(entry?.source?.identity).toEqual(ID);
  });

  it('custom idFrom that generates duplicate ids → last-write-wins (pinned)', async () => {
    const scope = makeScope({
      turnNumber: 1,
      newMessages: [msg('user', 'first'), msg('user', 'second')],
    });
    // All messages get id 'fixed' — second overwrites first. Pinned so
    // consumers know the behavior; no silent merge.
    await writeMessages({ store, idFrom: () => 'fixed' })(scope as never);
    const entry = await store.get<Message>(ID, 'fixed');
    expect(entry?.value.content).toBe('second');
    expect((await store.list(ID)).entries.length).toBe(1);
  });
});
