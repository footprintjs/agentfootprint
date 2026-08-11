/**
 * Turn identity — regression for "episodic memory remembers one exchange".
 *
 * BUG (through 9.5.1): the Agent's seed stage wrote `turnNumber = 1` on EVERY
 * run, and `writeMessages` ids entries `msg-{turn}-{index}` — so every turn of
 * a conversation overwrote `msg-1-0` / `msg-1-1`, and a `.memory()` declaring
 * a twelve-turn window recalled exactly one prior exchange. Silently: nothing
 * threw, the store reported successful writes, and the only symptom was an
 * agent that kept forgetting.
 *
 * FIX (9.6.0): the turn is an ordinal resolved ONCE per run —
 * `max(hostTurn, maxStoredTurn + 1)` — from the conversation the run was
 * handed AND from the memory stores themselves, which is the only anchor that
 * survives a fresh Agent (or a fresh process) per turn.
 *
 * Covers: unit (the rule), functional (fresh agent per turn — the field
 * shape), integration (recall across turns through the window), security
 * (one conversation cannot advance another's turn), boundary (empty store,
 * unnumbered entries, expired entries, cursor paging), compat (an agent with
 * no memory is unchanged; turn one still writes `msg-1-*`).
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  maxStoredTurn,
  mockEmbedder,
  resolveTurnNumber,
} from '../../../src/memory/index.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';
import type { MemoryStore } from '../../../src/memory/store/index.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';

const ID: MemoryIdentity = { tenant: 'acme', conversationId: 'conv-turns' };

/** An entry shaped like the ones the write stages produce. */
function entry(id: string, turn?: number, ttl?: number): MemoryEntry<string> {
  const now = Date.now();
  return {
    id,
    value: `payload ${id}`,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...(ttl !== undefined && { ttl }),
    ...(turn !== undefined && { source: { turn, identity: ID } }),
  };
}

/** Records what every request carried, so recall can be asserted on the wire. */
function recordingProvider(reply = 'ok'): {
  provider: LLMProvider;
  requests: LLMRequest[];
} {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'recording',
    carriesInMessages: ['user', 'assistant', 'system', 'tool'],
    async complete(req) {
      requests.push(req);
      return { content: reply, toolCalls: [], usage: { input: 10, output: 5 } };
    },
  };
  return { provider, requests };
}

/** The field shape: a FRESH agent per turn, one store, one conversationId. */
function freshAgent(store: MemoryStore, provider: LLMProvider) {
  return Agent.create({ provider, model: 'mock', maxIterations: 2 })
    .system('You are a helpful assistant.')
    .memory(
      defineMemory({
        id: 'conversation',
        description: 'Remember the last 12 turns of this conversation.',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 12 },
        store,
      }),
    )
    .build();
}

async function messageIds(store: MemoryStore, identity: MemoryIdentity): Promise<string[]> {
  const listed = await store.list(identity, { limit: 200 });
  return listed.entries
    .map((e) => e.id)
    .filter((id) => id.startsWith('msg-'))
    .sort();
}

// ── Unit — the rule ──────────────────────────────────────────

describe('resolveTurnNumber — unit', () => {
  it('an empty store keeps the host turn (a first turn is turn 1)', async () => {
    const store = new InMemoryStore();
    expect(await resolveTurnNumber({ stores: [store], identity: ID })).toBe(1);
    expect(await resolveTurnNumber({ stores: [store], identity: ID, hostTurn: 4 })).toBe(4);
  });

  it('a STALE host counter is raised to the next unused turn', async () => {
    const store = new InMemoryStore();
    await store.put(ID, entry('msg-1-0', 1));
    await store.put(ID, entry('msg-1-1', 1));
    // The host says "turn 1" on every run — the store says otherwise.
    expect(await resolveTurnNumber({ stores: [store], identity: ID, hostTurn: 1 })).toBe(2);
  });

  it('an HONEST host counter is kept, gaps and all (an ordinal, not a count)', async () => {
    const store = new InMemoryStore();
    await store.put(ID, entry('msg-1-0', 1));
    expect(await resolveTurnNumber({ stores: [store], identity: ID, hostTurn: 9 })).toBe(9);
  });

  it('several stores agree on ONE turn — the highest wins', async () => {
    const messages = new InMemoryStore();
    const snapshots = new InMemoryStore();
    await messages.put(ID, entry('msg-2-0', 2));
    await snapshots.put(ID, entry('snap-5', 5));
    expect(await resolveTurnNumber({ stores: [messages, snapshots], identity: ID })).toBe(6);
  });

  it('scans a duplicated store once (same reference, several memories)', async () => {
    const store = new InMemoryStore();
    let calls = 0;
    const counting: MemoryStore = Object.assign(Object.create(store) as MemoryStore, {
      list: (identity: MemoryIdentity, options?: { limit?: number }) => {
        calls++;
        return store.list(identity, options);
      },
    });
    await resolveTurnNumber({ stores: [counting, counting, counting], identity: ID });
    expect(calls).toBe(1);
  });

  it('a host turn that is not a turn (0, NaN, undefined) falls back to 1', async () => {
    const store = new InMemoryStore();
    expect(await resolveTurnNumber({ stores: [store], identity: ID, hostTurn: 0 })).toBe(1);
    expect(await resolveTurnNumber({ stores: [store], identity: ID, hostTurn: NaN })).toBe(1);
    expect(await resolveTurnNumber({ stores: [store], identity: ID })).toBe(1);
  });

  it('a store that throws is NOT swallowed — a guessed turn is how memory overwrites itself', async () => {
    const broken = {
      list: async () => {
        throw new Error('redis down');
      },
    } as unknown as MemoryStore;
    await expect(resolveTurnNumber({ stores: [broken], identity: ID })).rejects.toThrow(
      'redis down',
    );
  });
});

// ── Boundary — what counts as a stored turn ──────────────────

describe('maxStoredTurn — boundary', () => {
  it('entries with no source.turn do not hold the numbering open', async () => {
    const store = new InMemoryStore();
    await store.put(ID, entry('sig-abc'));
    expect(await maxStoredTurn(store, ID)).toBe(0);
  });

  it('EXPIRED entries are invisible, exactly as they are to every read', async () => {
    const store = new InMemoryStore();
    await store.put(ID, entry('msg-3-0', 3, Date.now() - 1_000));
    expect(await maxStoredTurn(store, ID)).toBe(0);
  });

  it('reads every page, not just the first', async () => {
    const store = new InMemoryStore();
    let page = 0;
    const paged: MemoryStore = Object.assign(Object.create(store) as MemoryStore, {
      list: async () => {
        page++;
        if (page === 1) return { entries: [entry('msg-1-0', 1)], cursor: 'next' };
        return { entries: [entry('msg-7-0', 7)] };
      },
    });
    expect(await maxStoredTurn(paged, ID)).toBe(7);
  });

  it('stops instead of paging forever when an adapter echoes its own cursor', async () => {
    const store = new InMemoryStore();
    let calls = 0;
    const looping: MemoryStore = Object.assign(Object.create(store) as MemoryStore, {
      list: async () => {
        calls++;
        return { entries: [entry('msg-2-0', 2)], cursor: 'same' };
      },
    });
    expect(await maxStoredTurn(looping, ID)).toBe(2);
    expect(calls).toBeLessThanOrEqual(2);
  });
});

// ── Functional — the field shape ─────────────────────────────

describe('multi-turn memory — a fresh Agent per turn', () => {
  it('six turns store TWELVE message entries, one pair per turn', async () => {
    const store = new InMemoryStore();
    const identity = { conversationId: 'conv-probe-1' };

    for (let turn = 1; turn <= 6; turn++) {
      const agent = freshAgent(store, mock({ reply: `answer ${turn}` }));
      await agent.run({ message: `Turn ${turn}: what do you remember?`, identity });
    }

    const ids = await messageIds(store, identity);
    expect(ids).toEqual([
      'msg-1-0',
      'msg-1-1',
      'msg-2-0',
      'msg-2-1',
      'msg-3-0',
      'msg-3-1',
      'msg-4-0',
      'msg-4-1',
      'msg-5-0',
      'msg-5-1',
      'msg-6-0',
      'msg-6-1',
    ]);
  });

  it('turn one is unchanged — `msg-1-0` / `msg-1-1`, as every earlier release wrote', async () => {
    const store = new InMemoryStore();
    const agent = freshAgent(store, mock({ reply: 'hello' }));
    await agent.run({ message: 'hi', identity: ID });

    expect(await messageIds(store, ID)).toEqual(['msg-1-0', 'msg-1-1']);
    const first = await store.get(ID, 'msg-1-0');
    expect(first?.source?.turn).toBe(1);
  });
});

// ── Integration — the window actually recalls ────────────────

describe('multi-turn memory — WINDOW size 12 recalls across turns', () => {
  it("turn six's prompt carries the earlier turns, not just the last one", async () => {
    const store = new InMemoryStore();
    const identity = { conversationId: 'conv-recall' };
    const facts = [
      'my name is Alice',
      'I work in the Zurich office',
      'my badge number is 4417',
      'my manager is Dana',
      'I prefer answers in metric',
    ];

    for (const fact of facts) {
      const agent = freshAgent(store, mock({ reply: 'noted' }));
      await agent.run({ message: fact, identity });
    }

    const { provider, requests } = recordingProvider('summary');
    const last = freshAgent(store, provider);
    await last.run({ message: 'what do you know?', identity });

    const prompt = requests[0]?.systemPrompt ?? '';
    for (const fact of facts) expect(prompt).toContain(fact);
  });

  it('a followed-up conversation in ONE process numbers its turns too', async () => {
    const store = new InMemoryStore();
    const agent = freshAgent(store, mock({ reply: 'ok' }));

    await agent.run({ message: 'first', identity: ID });
    await agent.followUp('second');
    await agent.followUp('third');

    const ids = await messageIds(store, ID);
    expect(ids).toEqual(['msg-1-0', 'msg-1-1', 'msg-2-0', 'msg-2-1', 'msg-3-0', 'msg-3-1']);
  });
});

// ── Integration — two memories, one conversation, one ordinal ─

describe('multi-turn memory — several memories agree on the turn', () => {
  it('messages and causal snapshots of one turn share its number', async () => {
    const store = new InMemoryStore();
    const identity = { conversationId: 'conv-two-memories' };

    for (let turn = 1; turn <= 3; turn++) {
      const agent = Agent.create({
        provider: mock({ reply: `answer ${turn}` }),
        model: 'mock',
        maxIterations: 2,
      })
        .memory(
          defineMemory({
            id: 'conversation',
            type: MEMORY_TYPES.EPISODIC,
            strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 12 },
            store,
          }),
        )
        .memory(
          defineMemory({
            id: 'why',
            type: MEMORY_TYPES.CAUSAL,
            strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 2, embedder: mockEmbedder() },
            store,
          }),
        )
        .build();
      await agent.run({ message: `question ${turn}`, identity });
    }

    const listed = await store.list(identity, { limit: 200 });
    const ids = listed.entries.map((e) => e.id).sort();
    // One (user, assistant) pair AND one snapshot per turn, all numbered the
    // same way — a second memory must not push the ordinal forward.
    expect(ids.filter((id) => id.startsWith('msg-'))).toEqual([
      'msg-1-0',
      'msg-1-1',
      'msg-2-0',
      'msg-2-1',
      'msg-3-0',
      'msg-3-1',
    ]);
    expect(ids.filter((id) => id.startsWith('snap-'))).toEqual(['snap-1', 'snap-2', 'snap-3']);
  });
});

// ── Security — namespaces are separate conversations ─────────

describe('turn identity — isolation', () => {
  it('one conversation cannot advance another conversation’s turn', async () => {
    const store = new InMemoryStore();
    const alice = { tenant: 'acme', conversationId: 'alice' };
    const bob = { tenant: 'acme', conversationId: 'bob' };

    for (const identity of [alice, alice, alice]) {
      const agent = freshAgent(store, mock({ reply: 'ok' }));
      await agent.run({ message: 'hello', identity });
    }
    const agent = freshAgent(store, mock({ reply: 'ok' }));
    await agent.run({ message: 'hello', identity: bob });

    expect(await messageIds(store, alice)).toEqual([
      'msg-1-0',
      'msg-1-1',
      'msg-2-0',
      'msg-2-1',
      'msg-3-0',
      'msg-3-1',
    ]);
    expect(await messageIds(store, bob)).toEqual(['msg-1-0', 'msg-1-1']);
  });
});

// ── Compat — an agent with no memory is untouched ────────────

describe('turn identity — agents without memory', () => {
  it('makes no store call and still reports turn 1', async () => {
    const { provider, requests } = recordingProvider('done');
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 1 })
      .system('no memory here')
      .build();

    await agent.run({ message: 'hi' });

    expect(requests.length).toBe(1);
    const state = agent.getLastSnapshot()?.sharedState as { turnNumber?: number } | undefined;
    expect(state?.turnNumber).toBe(1);
  });
});
