/**
 * Tests for PrepareMemory subflow — LoadHistory → ApplyStrategy.
 *
 * Tiers:
 * - unit:     LoadHistory loads + merges; ApplyStrategy applies strategy
 * - boundary: no store, no strategy, empty store, empty current messages
 * - scenario: fresh conversation, returning user, strategy trims history
 * - property: no store → output equals input; no strategy → output equals merged
 * - security: store.load() throws, strategy.prepare() throws, malformed store return
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { createPrepareMemorySubflow } from '../../src/subflows/prepareMemory';
import { InMemoryStore } from '../../src/adapters/memory/inMemory';
import type { Message } from '../../src/types/messages';
import type { MessageStrategy } from '../../src/core/providers';
import type { PrepareMemoryConfig } from '../../src/subflows/prepareMemory';
import type { MessagesSubflowState } from '../../src/scope/types';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({ role: 'assistant', content: text });

/**
 * Run the PrepareMemory subflow mounted inside a wrapper chart.
 * The wrapper seed stage writes currentMessages to scope; inputMapper/outputMapper
 * shuttle data in and out of the subflow — exactly as Agent.ts will do.
 */
async function runSubflow(
  config: PrepareMemoryConfig,
  currentMessages: Message[],
): Promise<Record<string, unknown>> {
  const subflow = createPrepareMemorySubflow(config);

  const wrapper = flowChart<MessagesSubflowState>(
    'Seed',
    (scope) => {
      scope.currentMessages = currentMessages;
    },
    'test-seed',
  )
    .addSubFlowChartNext('sf-prepare', subflow, 'PrepareMemory', {
      inputMapper: (parent: Record<string, unknown>) => ({
        currentMessages: (parent['currentMessages'] as Message[]) ?? [],
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        memory_storedHistory: sfOutput['memory_storedHistory'],
        memory_preparedMessages: sfOutput['memory_preparedMessages'],
      }),
    })
    .build();

  const executor = new FlowChartExecutor(wrapper);
  await executor.run({});
  return executor.getSnapshot().sharedState;
}

// ── Unit ─────────────────────────────────────────────────────

describe('PrepareMemory — unit: LoadHistory', () => {
  it('with store: loads stored history and merges with current messages', async () => {
    const store = new InMemoryStore();
    store.save('conv-1', [user('turn 1'), assistant('reply 1')]);

    const state = await runSubflow(
      { store, conversationId: 'conv-1' },
      [user('turn 2')],
    );

    const stored = state.memory_storedHistory as Message[];
    expect(stored).toHaveLength(3);
    expect(stored[0].content as string).toBe('turn 1');
    expect(stored[2].content as string).toBe('turn 2');
  });

  it('with store: fresh conversation — stored history is just current messages', async () => {
    const store = new InMemoryStore();
    const state = await runSubflow(
      { store, conversationId: 'conv-new' },
      [user('first message')],
    );
    expect(state.memory_storedHistory).toEqual([user('first message')]);
  });

  it('without store: stored history equals current messages (pass-through)', async () => {
    const current = [user('hello'), assistant('hi')];
    const state = await runSubflow({}, current);
    expect(state.memory_storedHistory).toEqual(current);
  });
});

describe('PrepareMemory — unit: ApplyStrategy', () => {
  it('with strategy: calls strategy.prepare() with merged history', async () => {
    const prepareSpy = vi.fn(async (msgs: Message[]) => msgs.slice(-1));
    const strategy: MessageStrategy = { prepare: prepareSpy };

    const state = await runSubflow(
      { strategy },
      [user('hello'), assistant('hi'), user('question')],
    );

    expect(prepareSpy).toHaveBeenCalledOnce();
    // Verify the MessageContext shape passed to prepare() — all zeros (subflow has no turn context)
    expect(prepareSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ message: '', turnNumber: 0, loopIteration: 0 }),
    );
    const prepared = state.memory_preparedMessages as Message[];
    expect(prepared).toHaveLength(1);
  });

  it('without strategy: prepared messages equal stored history', async () => {
    const store = new InMemoryStore();
    store.save('conv-1', [user('stored')]);

    const state = await runSubflow({ store, conversationId: 'conv-1' }, [user('new')]);

    expect(state.memory_preparedMessages).toEqual(state.memory_storedHistory);
  });

  it('both STORED_HISTORY and PREPARED_MESSAGES are written to scope', async () => {
    const state = await runSubflow({}, [user('test')]);
    expect(state).toHaveProperty('memory_storedHistory');
    expect(state).toHaveProperty('memory_preparedMessages');
  });
});

// ── Boundary ─────────────────────────────────────────────────

describe('PrepareMemory — boundary', () => {
  it('empty current messages + no store → both outputs are empty arrays', async () => {
    const state = await runSubflow({}, []);
    expect(state.memory_storedHistory).toEqual([]);
    expect(state.memory_preparedMessages).toEqual([]);
  });

  it('store with empty history → output equals current messages', async () => {
    const store = new InMemoryStore();
    const state = await runSubflow({ store, conversationId: 'new-conv' }, [user('first')]);
    expect(state.memory_preparedMessages).toEqual([user('first')]);
  });

  it('no conversationId with store provided → treated as no store (pass-through)', async () => {
    const store = new InMemoryStore();
    store.save('conv-1', [user('stored but not loaded')]);
    const state = await runSubflow({ store }, [user('current')]);
    expect(state.memory_storedHistory).toEqual([user('current')]);
  });

  it('strategy receiving empty array returns empty array', async () => {
    const strategy: MessageStrategy = { prepare: async (msgs) => msgs };
    const state = await runSubflow({ strategy }, []);
    expect(state.memory_preparedMessages).toEqual([]);
  });
});

// ── Scenario ─────────────────────────────────────────────────

describe('PrepareMemory — scenario', () => {
  it('returning user: stored history from prior session merged with new turn', async () => {
    const store = new InMemoryStore();
    store.save('user-abc', [
      user('session 1 question'),
      assistant('session 1 answer'),
      user('session 1 follow-up'),
      assistant('session 1 follow-up answer'),
    ]);

    const state = await runSubflow(
      { store, conversationId: 'user-abc' },
      [user('session 2 question')],
    );

    const prepared = state.memory_preparedMessages as Message[];
    expect(prepared).toHaveLength(5);
    expect(prepared[4].content as string).toBe('session 2 question');
  });

  it('slidingWindow strategy keeps only last N messages', async () => {
    const store = new InMemoryStore();
    const history = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0 ? user(`q${i}`) : assistant(`a${i}`),
    );
    store.save('conv-1', history);

    const strategy: MessageStrategy = { prepare: async (msgs) => msgs.slice(-3) };
    const state = await runSubflow(
      { store, conversationId: 'conv-1', strategy },
      [user('new question')],
    );

    const prepared = state.memory_preparedMessages as Message[];
    expect(prepared).toHaveLength(3);
  });

  it('no store, no strategy — subflow is a cheap pass-through', async () => {
    const msgs = [user('a'), assistant('b'), user('c')];
    const state = await runSubflow({}, msgs);
    expect(state.memory_preparedMessages).toEqual(msgs);
  });
});

// ── Property ─────────────────────────────────────────────────

describe('PrepareMemory — property', () => {
  it('without store: prepared messages === current input (identity)', async () => {
    const current = [user('x'), assistant('y'), user('z')];
    const state = await runSubflow({}, current);
    expect(state.memory_preparedMessages).toEqual(current);
  });

  it('without strategy: prepared messages === stored history', async () => {
    const store = new InMemoryStore();
    store.save('c', [user('old')]);
    const state = await runSubflow({ store, conversationId: 'c' }, [user('new')]);
    expect(state.memory_preparedMessages).toEqual(state.memory_storedHistory);
  });

  it('strategy output is exactly what strategy.prepare returns', async () => {
    const fixed: Message[] = [user('fixed output')];
    const strategy: MessageStrategy = { prepare: async () => fixed };
    const state = await runSubflow({ strategy }, [user('anything')]);
    expect(state.memory_preparedMessages).toEqual(fixed);
  });
});

// ── Security ─────────────────────────────────────────────────

describe('PrepareMemory — security', () => {
  it('store.load() throwing propagates the error', async () => {
    const badStore: import('../../src/adapters/memory/types').ConversationStore = {
      load: async () => { throw new Error('DB connection failed'); },
      save: async () => {},
    };

    await expect(
      runSubflow({ store: badStore, conversationId: 'c' }, [user('test')]),
    ).rejects.toThrow('DB connection failed');
  });

  it('strategy.prepare() throwing propagates the error', async () => {
    const badStrategy: MessageStrategy = {
      prepare: async () => { throw new Error('strategy failed'); },
    };

    await expect(
      runSubflow({ strategy: badStrategy }, [user('test')]),
    ).rejects.toThrow('strategy failed');
  });

  it('store.load() returning null treated as empty — does not crash', async () => {
    const nullStore: import('../../src/adapters/memory/types').ConversationStore = {
      load: async () => null as any,
      save: async () => {},
    };

    const state = await runSubflow(
      { store: nullStore, conversationId: 'c' },
      [user('current')],
    );
    // null treated as empty history — prepared messages == current messages
    expect(state.memory_preparedMessages).toEqual([user('current')]);
  });
});
