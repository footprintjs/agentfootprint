/**
 * Tests for CommitMemory stage.
 *
 * Tiers:
 * - unit:     shouldCommit=true saves + breaks; shouldCommit=false is no-op
 * - boundary: no messages in scope, store.save() called exactly once per commit
 * - scenario: multi-turn loop — commit fires only on final turn
 * - property: save receives exact message snapshot from scope
 * - security: store.save() throws — onSaveError called, pipeline still breaks
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import { createCommitMemoryStage } from '../../src/stages/commitMemory';
import { InMemoryStore } from '../../src/adapters/memory/inMemory';
import { agentScopeFactory } from '../../src/executor/scopeFactory';
import { AgentScope, MEMORY_PATHS } from '../../src/scope/AgentScope';
import type { Message } from '../../src/types/messages';
import type { CommitMemoryConfig } from '../../src/stages/commitMemory';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({ role: 'assistant', content: text });

/** Flush macrotasks — necessary for fire-and-forget Promises to settle. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Run a chart that:
 *  1. Seeds scope with `messages` and `shouldCommit` flag
 *  2. Runs CommitMemory stage
 */
async function runCommitStage(
  config: CommitMemoryConfig,
  messages: Message[],
  shouldCommit: boolean,
): Promise<{ state: Record<string, unknown>; brokeEarly: boolean }> {
  let brokeEarly = false;

  const stage = createCommitMemoryStage(config);

  const chart = flowChart(
    'Seed',
    (scope: ScopeFacade) => {
      AgentScope.setMessages(scope, messages);
      AgentScope.setShouldCommit(scope, shouldCommit);
    },
    'test-seed',
  )
    .addFunction(
      'CommitMemory',
      async (scope: ScopeFacade, breakPipeline: () => void) => {
        await stage(scope, () => {
          brokeEarly = true;
          breakPipeline();
        });
      },
      'commit-memory',
    )
    .build();

  const executor = new FlowChartExecutor(chart, { scopeFactory: agentScopeFactory });
  await executor.run({});
  return { state: executor.getSnapshot().sharedState, brokeEarly };
}

// ── Unit ─────────────────────────────────────────────────────

describe('CommitMemory — unit', () => {
  it('shouldCommit=true: calls store.save() and breaks pipeline', async () => {
    const store = new InMemoryStore();
    const saveSpy = vi.spyOn(store, 'save');

    const messages = [user('hello'), assistant('hi')];
    const { brokeEarly } = await runCommitStage(
      { store, conversationId: 'conv-1' },
      messages,
      true,
    );

    expect(brokeEarly).toBe(true);
    await flush();
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(saveSpy).toHaveBeenCalledWith('conv-1', messages);
  });

  it('shouldCommit=false: does NOT call store.save() and does NOT break pipeline', async () => {
    const store = new InMemoryStore();
    const saveSpy = vi.spyOn(store, 'save');

    const { brokeEarly } = await runCommitStage(
      { store, conversationId: 'conv-1' },
      [user('hello')],
      false,
    );

    await flush();
    expect(brokeEarly).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('after committing, SHOULD_COMMIT flag is reset to false', async () => {
    const store = new InMemoryStore();
    const { state } = await runCommitStage(
      { store, conversationId: 'conv-1' },
      [user('test')],
      true,
    );

    expect(state[MEMORY_PATHS.SHOULD_COMMIT]).toBe(false);
  });
});

// ── Boundary ─────────────────────────────────────────────────

describe('CommitMemory — boundary', () => {
  it('empty messages array: saves empty array without error', async () => {
    const store = new InMemoryStore();
    const saveSpy = vi.spyOn(store, 'save');

    const { brokeEarly } = await runCommitStage(
      { store, conversationId: 'conv-empty' },
      [],
      true,
    );

    await flush();
    expect(brokeEarly).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith('conv-empty', []);
  });

  it('store.save() called exactly once per commit (not multiple times)', async () => {
    const store = new InMemoryStore();
    const saveSpy = vi.spyOn(store, 'save');

    await runCommitStage({ store, conversationId: 'c' }, [user('x')], true);

    await flush();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('shouldCommit=false with store that has data: store not touched', async () => {
    const store = new InMemoryStore();
    store.save('conv-1', [user('prior')]);
    const saveSpy = vi.spyOn(store, 'save');
    saveSpy.mockClear();

    await runCommitStage({ store, conversationId: 'conv-1' }, [user('new')], false);

    await flush();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(store.load('conv-1')).toEqual([user('prior')]);
  });
});

// ── Scenario ─────────────────────────────────────────────────

describe('CommitMemory — scenario', () => {
  it('multi-turn: commit fires only on the final turn (shouldCommit=true)', async () => {
    const store = new InMemoryStore();
    const saveSpy = vi.spyOn(store, 'save');

    for (let i = 0; i < 2; i++) {
      await runCommitStage({ store, conversationId: 'sess' }, [user(`q${i}`)], false);
    }
    await runCommitStage({ store, conversationId: 'sess' }, [user('final')], true);

    await flush();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('after commit, store contains the final message list', async () => {
    const store = new InMemoryStore();
    const msgs = [user('question'), assistant('answer')];
    await runCommitStage({ store, conversationId: 'sess' }, msgs, true);

    await flush();
    expect(store.load('sess')).toEqual(msgs);
  });

  it('onSaveError not called when save succeeds', async () => {
    const onSaveError = vi.fn();
    const store = new InMemoryStore();

    await runCommitStage(
      { store, conversationId: 'c', onSaveError },
      [user('ok')],
      true,
    );

    await flush();
    expect(onSaveError).not.toHaveBeenCalled();
  });
});

// ── Property ─────────────────────────────────────────────────

describe('CommitMemory — property', () => {
  it('save() receives exact messages from scope', async () => {
    const saveSpy = vi.fn<[string, Message[]], void | Promise<void>>();
    const fakeStore = { load: async () => [], save: saveSpy };

    const messages = [user('a'), assistant('b'), user('c')];
    await runCommitStage({ store: fakeStore, conversationId: 'c' }, messages, true);

    await flush();
    expect(saveSpy).toHaveBeenCalledWith('c', messages);
  });

  it('conversationId passed to save() matches config exactly', async () => {
    const saveSpy = vi.fn<[string, Message[]], void | Promise<void>>();
    const fakeStore = { load: async () => [], save: saveSpy };

    await runCommitStage(
      { store: fakeStore, conversationId: 'user-abc-123' },
      [user('x')],
      true,
    );

    await flush();
    expect(saveSpy.mock.calls[0][0]).toBe('user-abc-123');
  });

  it('no commit when shouldCommit=false regardless of message count', async () => {
    const saveSpy = vi.fn();
    const fakeStore = { load: async () => [], save: saveSpy };

    const manyMessages = Array.from({ length: 50 }, (_, i) => user(`msg${i}`));
    const { brokeEarly } = await runCommitStage(
      { store: fakeStore, conversationId: 'c' },
      manyMessages,
      false,
    );

    await flush();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(brokeEarly).toBe(false);
  });
});

// ── Security ─────────────────────────────────────────────────

describe('CommitMemory — security', () => {
  it('async store.save() throwing: onSaveError is called with the error', async () => {
    const onSaveError = vi.fn();
    const err = new Error('Redis connection refused');
    const badStore = {
      load: async () => [],
      save: async () => { throw err; },
    };

    await runCommitStage(
      { store: badStore, conversationId: 'c', onSaveError },
      [user('test')],
      true,
    );

    await flush();
    expect(onSaveError).toHaveBeenCalledWith(err);
  });

  it('async store.save() throwing without onSaveError: pipeline still breaks', async () => {
    const badStore = {
      load: async () => [],
      save: async () => { throw new Error('DB failed'); },
    };

    // runCommitStage must resolve and brokeEarly must be true even when save() fails
    const { brokeEarly } = await runCommitStage(
      { store: badStore, conversationId: 'c' },
      [user('test')],
      true,
    );

    await flush();
    expect(brokeEarly).toBe(true);
  });

  it('save() throwing: SHOULD_COMMIT flag is reset to false regardless of save outcome', async () => {
    const badStore = {
      load: async () => [],
      save: async () => { throw new Error('timeout'); },
    };

    const { state } = await runCommitStage(
      { store: badStore, conversationId: 'c' },
      [user('test')],
      true,
    );

    expect(state[MEMORY_PATHS.SHOULD_COMMIT]).toBe(false);
  });

  it('async save() throws and no onSaveError: emits console.warn in dev mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    const badStore = {
      load: async () => [],
      save: async () => { throw new Error('storage error'); },
    };

    try {
      await runCommitStage({ store: badStore, conversationId: 'c' }, [user('x')], true);
      await flush();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('CommitMemory'),
        expect.any(Error),
      );
    } finally {
      process.env['NODE_ENV'] = originalEnv;
      warnSpy.mockRestore();
    }
  });
});
