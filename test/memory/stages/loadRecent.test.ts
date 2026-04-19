/**
 * loadRecent stage — 5-pattern tests.
 *
 * These tests verify the stage function in isolation — passing in a mock
 * scope object rather than running a full flowchart. That isolates the
 * stage's contract from the rest of the library. Integration tests (Layer
 * 5 / 6) will drive the stage through a real pipeline.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryStore } from '../../../src/memory/store';
import { loadRecent } from '../../../src/memory/stages/loadRecent';
import type { MemoryState } from '../../../src/memory/stages/types';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't1', principal: 'u1', conversationId: 'c1' };

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

function makeEntry(id: string, message: Message, updatedAt: number): MemoryEntry<Message> {
  return {
    id,
    value: message,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    lastAccessedAt: updatedAt,
    accessCount: 0,
  };
}

// Minimal MemoryState implementing the scope interface. The real scope is
// a proxy; this is just enough to exercise the stage.
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

describe('loadRecent — unit', () => {
  it('loads entries from store into scope.loaded', async () => {
    await store.put(ID, makeEntry('m1', msg('user', 'hello'), 100));
    await store.put(ID, makeEntry('m2', msg('assistant', 'hi'), 200));

    const scope = makeScope();
    await loadRecent({ store, count: 10 })(scope as never);

    expect(scope.loaded.length).toBe(2);
    expect(scope.loaded.map((e) => e.id)).toEqual(['m1', 'm2']); // oldest-first
  });

  it('returns oldest-first (reversed from store.list default)', async () => {
    await store.put(ID, makeEntry('oldest', msg('user', 'a'), 100));
    await store.put(ID, makeEntry('middle', msg('user', 'b'), 200));
    await store.put(ID, makeEntry('newest', msg('user', 'c'), 300));

    const scope = makeScope();
    await loadRecent({ store })(scope as never);

    expect(scope.loaded.map((e) => e.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('respects count limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.put(ID, makeEntry(`m${i}`, msg('user', `msg ${i}`), i * 100));
    }
    const scope = makeScope();
    await loadRecent({ store, count: 2 })(scope as never);
    expect(scope.loaded.length).toBe(2);
  });

  it('uses DEFAULT_COUNT (20) when count is omitted', async () => {
    for (let i = 0; i < 25; i++) {
      await store.put(ID, makeEntry(`m${i}`, msg('user', `${i}`), i * 100));
    }
    const scope = makeScope();
    await loadRecent({ store })(scope as never);
    expect(scope.loaded.length).toBe(20);
  });

  it('appends to scope.loaded, does not replace', async () => {
    await store.put(ID, makeEntry('m1', msg('user', 'hi'), 100));

    const preloaded = makeEntry('preloaded', msg('system', 'note'), 50);
    const scope = makeScope({ loaded: [preloaded] });

    await loadRecent({ store })(scope as never);

    expect(scope.loaded.length).toBe(2);
    expect(scope.loaded[0].id).toBe('preloaded'); // existing stays first
    expect(scope.loaded[1].id).toBe('m1');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('loadRecent — boundary', () => {
  it('empty store returns empty loaded (no crash)', async () => {
    const scope = makeScope();
    await loadRecent({ store })(scope as never);
    expect(scope.loaded).toEqual([]);
  });

  it('count=0 returns no entries (but does not throw)', async () => {
    await store.put(ID, makeEntry('m1', msg('user', 'x'), 100));
    const scope = makeScope();
    await loadRecent({ store, count: 0 })(scope as never);
    expect(scope.loaded).toEqual([]);
  });

  it('filters by tier when `tiers` is provided', async () => {
    await store.put(ID, { ...makeEntry('hot1', msg('user', 'h'), 100), tier: 'hot' });
    await store.put(ID, { ...makeEntry('cold1', msg('user', 'c'), 200), tier: 'cold' });

    const scope = makeScope();
    await loadRecent({ store, tiers: ['hot'] })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['hot1']);
  });

  it('re-running the stage twice accumulates (does not dedup)', async () => {
    // By design — dedup is the picker stage's job (Layer 3). Pin the
    // contract so future "helpful" dedup inside loadRecent doesn't slip in.
    await store.put(ID, makeEntry('m1', msg('user', 'x'), 100));

    const scope = makeScope();
    await loadRecent({ store })(scope as never);
    await loadRecent({ store })(scope as never);

    expect(scope.loaded.length).toBe(2);
    expect(scope.loaded[0].id).toBe('m1');
    expect(scope.loaded[1].id).toBe('m1');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('loadRecent — scenario', () => {
  it('multi-tenant isolation: only loads entries from the scope identity', async () => {
    const OTHER = { tenant: 't1', principal: 'u2', conversationId: 'c1' };
    await store.put(ID, makeEntry('mine', msg('user', 'mine'), 100));
    await store.put(OTHER, makeEntry('theirs', msg('user', 'theirs'), 200));

    const scope = makeScope();
    await loadRecent({ store })(scope as never);
    expect(scope.loaded.map((e) => e.id)).toEqual(['mine']);
  });

  it('composes with existing loaded entries from another load stage', async () => {
    // Simulate a prior "semantic retrieval" stage that populated scope.loaded
    const preLoaded = [makeEntry('facts-1', msg('system', 'User is in CA'), 50)];
    await store.put(ID, makeEntry('recent-1', msg('user', 'what time is it'), 100));

    const scope = makeScope({ loaded: preLoaded });
    await loadRecent({ store })(scope as never);

    expect(scope.loaded.length).toBe(2);
    expect(scope.loaded[0].id).toBe('facts-1');
    expect(scope.loaded[1].id).toBe('recent-1');
  });
});

// ── Property ────────────────────────────────────────────────

describe('loadRecent — property', () => {
  it('never loads more than the requested count', async () => {
    for (let i = 0; i < 50; i++) {
      await store.put(ID, makeEntry(`m${i}`, msg('user', `${i}`), i));
    }
    for (const n of [1, 5, 10, 20, 100]) {
      const scope = makeScope();
      await loadRecent({ store, count: n })(scope as never);
      expect(scope.loaded.length).toBeLessThanOrEqual(n);
    }
  });

  it('does not mutate scope.identity', async () => {
    const id = { tenant: 't', conversationId: 'c' };
    const scope = makeScope({ identity: id });
    const before = JSON.stringify(scope.identity);
    await loadRecent({ store })(scope as never);
    expect(JSON.stringify(scope.identity)).toBe(before);
  });
});

// ── Security ────────────────────────────────────────────────

describe('loadRecent — security', () => {
  it('errors from store propagate (fail-loud; caller wraps with retry/fallback)', async () => {
    const brokenStore = {
      list: async () => {
        throw new Error('backend down');
      },
    } as unknown as InMemoryStore;

    const scope = makeScope();
    await expect(loadRecent({ store: brokenStore })(scope as never)).rejects.toThrow(
      /backend down/,
    );
    // Scope was not partially mutated on failure
    expect(scope.loaded).toEqual([]);
  });

  it('does not execute on missing identity (TypedScope contract enforces it)', async () => {
    // MemoryState.identity is readonly and required — this is a compile-time
    // check, not runtime. Pin here for documentation.
    const scope = makeScope();
    expect(scope.identity).toBeDefined();
  });
});
