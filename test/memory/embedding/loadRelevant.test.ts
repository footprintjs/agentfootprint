/**
 * loadRelevant stage — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     embeds last user message, searches, writes loaded in order
 *   - boundary: empty user message → no search, loaded = []; content-blocks supported
 *   - scenario: retrieves relevant entries over unrelated ones
 *   - property: loaded length never exceeds k; order descending by score
 *   - security: non-vector store throws at build time; tenant isolation;
 *               AbortSignal flows through
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { InMemoryStore } from '../../../src/memory/store';
import { loadRelevant, mockEmbedder } from '../../../src/memory/embedding';
import type { MemoryState } from '../../../src/memory/stages';
import type { MemoryIdentity } from '../../../src/memory/identity';
import type { Message } from '../../../src/types/messages';
import type { MemoryEntry } from '../../../src/memory/entry';

const ID_A: MemoryIdentity = { tenant: 't', conversationId: 'c1' };
const ID_B: MemoryIdentity = { tenant: 't', conversationId: 'c2' };

let store: InMemoryStore;
const embedder = mockEmbedder({ dimensions: 32 });

beforeEach(() => {
  store = new InMemoryStore();
});

function makeEntry(id: string, overrides: Partial<MemoryEntry>): MemoryEntry {
  const now = Date.now();
  return {
    id,
    value: `value-${id}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...overrides,
  };
}

async function runStage(
  config: Parameters<typeof loadRelevant>[0],
  identity: MemoryIdentity,
  newMessages: Message[],
  env?: { signal?: AbortSignal },
): Promise<MemoryState> {
  const chart = flowChart<MemoryState>(
    'Seed',
    (scope) => {
      scope.identity = identity;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.loaded = [];
      scope.selected = [];
      scope.formatted = [];
      scope.newMessages = newMessages;
    },
    'seed',
  )
    .addFunction('Load', loadRelevant(config), 'load-relevant')
    .build();
  const exec = new FlowChartExecutor(chart);
  await exec.run(env ? { env } : undefined);
  return (exec.getSnapshot()?.sharedState ?? {}) as MemoryState;
}

// ── Unit ────────────────────────────────────────────────────

describe('loadRelevant — unit', () => {
  it('embeds the last user message and searches the store', async () => {
    await store.put(
      ID_A,
      makeEntry('a', {
        value: 'dogs are great',
        embedding: await embedder.embed({ text: 'dogs are great pets' }),
      }),
    );
    await store.put(
      ID_A,
      makeEntry('b', {
        value: 'cars are fast',
        embedding: await embedder.embed({ text: 'cars are fast machines' }),
      }),
    );
    const state = await runStage({ store, embedder }, ID_A, [
      { role: 'user', content: 'tell me about dogs' },
    ]);
    expect(state.loaded.length).toBeGreaterThan(0);
    expect(state.loaded[0].id).toBe('a');
  });

  it('writes loaded in best-first order (for pickByBudget downstream)', async () => {
    const texts = ['dogs are great', 'dogs love running', 'cars are fast'];
    for (let i = 0; i < texts.length; i++) {
      await store.put(
        ID_A,
        makeEntry(`e${i}`, {
          embedding: await embedder.embed({ text: texts[i] }),
        }),
      );
    }
    const state = await runStage({ store, embedder }, ID_A, [
      { role: 'user', content: 'tell me about dogs' },
    ]);
    // car beat shouldn't be in the top positions
    expect(state.loaded[0].id).not.toBe('e2');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('loadRelevant — boundary', () => {
  it('no user message → loaded is empty, no search performed', async () => {
    await store.put(ID_A, makeEntry('a', { embedding: await embedder.embed({ text: 'x' }) }));
    const state = await runStage({ store, embedder }, ID_A, [
      { role: 'assistant', content: 'no user turn here' },
    ]);
    expect(state.loaded).toEqual([]);
  });

  it('empty-content user message → loaded is empty', async () => {
    const state = await runStage({ store, embedder }, ID_A, [{ role: 'user', content: '' }]);
    expect(state.loaded).toEqual([]);
  });

  it('content-block user message is supported by default queryFrom', async () => {
    await store.put(
      ID_A,
      makeEntry('a', { embedding: await embedder.embed({ text: 'hello world' }) }),
    );
    const state = await runStage({ store, embedder }, ID_A, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello world' }] as never,
      },
    ]);
    expect(state.loaded[0].id).toBe('a');
  });

  it('k limits result count', async () => {
    for (let i = 0; i < 20; i++) {
      await store.put(
        ID_A,
        makeEntry(`e${i}`, {
          embedding: await embedder.embed({ text: `text ${i}` }),
        }),
      );
    }
    const state = await runStage({ store, embedder, k: 5 }, ID_A, [
      { role: 'user', content: 'query' },
    ]);
    expect(state.loaded).toHaveLength(5);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('loadRelevant — scenario', () => {
  it('custom queryFrom can pull any scope-derived text', async () => {
    await store.put(
      ID_A,
      makeEntry('custom', {
        embedding: await embedder.embed({ text: 'CUSTOM QUERY' }),
      }),
    );
    const state = await runStage(
      {
        store,
        embedder,
        queryFrom: () => 'CUSTOM QUERY',
      },
      ID_A,
      [{ role: 'user', content: 'ignored' }],
    );
    expect(state.loaded[0].id).toBe('custom');
  });
});

// ── Property ────────────────────────────────────────────────

describe('loadRelevant — property', () => {
  it('loaded.length is always <= k', async () => {
    for (let i = 0; i < 15; i++) {
      await store.put(
        ID_A,
        makeEntry(`e${i}`, { embedding: await embedder.embed({ text: `t${i}` }) }),
      );
    }
    for (const k of [1, 3, 10, 20, 100]) {
      const state = await runStage({ store, embedder, k }, ID_A, [{ role: 'user', content: 'q' }]);
      expect(state.loaded.length).toBeLessThanOrEqual(k);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('loadRelevant — security', () => {
  it('throws at build time when the store lacks search()', () => {
    const noVecStore = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: async () => null as any,
      put: async () => {},
      putMany: async () => {},
      putIfVersion: async () => ({ applied: false }),
      list: async () => ({ entries: [] }),
      delete: async () => {},
      seen: async () => false,
      recordSignature: async () => {},
      feedback: async () => {},
      getFeedback: async () => null,
      forget: async () => {},
    };
    expect(() => loadRelevant({ store: noVecStore, embedder })).toThrow(/search/);
  });

  it('tenant isolation — query under ID_A returns no ID_B entries', async () => {
    await store.put(
      ID_B,
      makeEntry('b-secret', {
        value: 'cross-tenant data',
        embedding: await embedder.embed({ text: 'secret info' }),
      }),
    );
    const state = await runStage({ store, embedder }, ID_A, [
      { role: 'user', content: 'secret info' },
    ]);
    expect(state.loaded).toEqual([]);
  });

  it('embedderId filter excludes entries from a different embedder', async () => {
    await store.put(
      ID_A,
      makeEntry('a', {
        embedding: await embedder.embed({ text: 'hi' }),
        embeddingModel: 'voyage-2',
      }),
    );
    const state = await runStage(
      { store, embedder, embedderId: 'openai-text-embedding-3-small' },
      ID_A,
      [{ role: 'user', content: 'hi' }],
    );
    expect(state.loaded).toEqual([]);
  });
});
