/**
 * Tests for Messages slot subflow.
 *
 * Tiers:
 * - unit:     in-memory mode applies strategy; persistent mode loads + applies
 * - boundary: empty history, store returns null
 * - scenario: sliding window trims, persistent merges stored + current
 * - property: output always array; strategy receives full history
 * - security: store.load() throws, strategy.prepare() throws
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import { buildMessagesSubflow } from '../../../src/lib/slots/messages';
import { agentScopeFactory } from '../../../src/executor/scopeFactory';
import { AgentScope, AGENT_PATHS, MEMORY_PATHS } from '../../../src/scope/AgentScope';
import { slidingWindow } from '../../../src/providers/messages/slidingWindow';
import type { MessageStrategy } from '../../../src/core/providers';
import type { Message } from '../../../src/types/messages';
import type { MessagesSlotConfig } from '../../../src/lib/slots/messages/types';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({ role: 'assistant', content: text });
const system = (text: string): Message => ({ role: 'system', content: text });

const fullHistory: MessageStrategy = { prepare: (history) => history };

function createTestStore(initial: Message[] = []) {
  const data = new Map<string, Message[]>();
  if (initial.length > 0) data.set('test-conv', initial);

  return {
    load: vi.fn(async (id: string) => data.get(id) ?? null),
    save: vi.fn(async (id: string, messages: Message[]) => { data.set(id, messages); }),
    clear: vi.fn(async () => { data.clear(); }),
  };
}

/**
 * Run the Messages subflow inside a wrapper chart.
 *
 * Follows the same pattern as Agent.ts:
 *   outputMapper writes to PREPARED_MESSAGES (temp key),
 *   then ApplyPreparedMessages stage copies to messages (avoids array append).
 */
async function runSubflow(
  config: MessagesSlotConfig,
  currentMessages: Message[] = [user('hello')],
): Promise<Record<string, unknown>> {
  const subflow = buildMessagesSubflow(config);

  const wrapper = flowChart(
    'Seed',
    (scope: ScopeFacade) => {
      AgentScope.setMessages(scope, currentMessages);
      AgentScope.setLoopCount(scope, 0);
    },
    'test-seed',
  )
    .addSubFlowChartNext('sf-messages', subflow, 'Messages', {
      inputMapper: (parent: Record<string, unknown>) => ({
        currentMessages: (parent[AGENT_PATHS.MESSAGES] as Message[]) ?? [],
        loopCount: (parent[AGENT_PATHS.LOOP_COUNT] as number) ?? 0,
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        [MEMORY_PATHS.PREPARED_MESSAGES]: sfOutput[MEMORY_PATHS.PREPARED_MESSAGES],
        [MEMORY_PATHS.STORED_HISTORY]: sfOutput[MEMORY_PATHS.STORED_HISTORY],
      }),
    })
    // Apply prepared messages to the main messages key (same pattern as Agent.ts)
    .addFunction(
      'ApplyPreparedMessages',
      (scope: ScopeFacade) => {
        const prepared = scope.getValue(MEMORY_PATHS.PREPARED_MESSAGES) as Message[] | undefined;
        if (prepared) {
          AgentScope.setMessages(scope, prepared);
        }
      },
      'apply-prepared-messages',
    )
    .build();

  const executor = new FlowChartExecutor(wrapper, { scopeFactory: agentScopeFactory });
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── Unit Tests ───────────────────────────────────────────────

describe('Messages slot — unit', () => {
  it('in-memory mode applies strategy to messages', async () => {
    const state = await runSubflow(
      { strategy: slidingWindow({ maxMessages: 2 }) },
      [user('a'), assistant('b'), user('c'), assistant('d'), user('e')],
    );
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('d');
    expect(messages[1].content).toBe('e');
  });

  it('persistent mode loads from store + applies strategy', async () => {
    const store = createTestStore([user('old1'), assistant('old2')]);
    const state = await runSubflow(
      { strategy: fullHistory, store, conversationId: 'test-conv' },
      [user('new')],
    );
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    expect(messages).toHaveLength(3);
    expect(store.load).toHaveBeenCalledWith('test-conv');
  });
});

// ── Boundary Tests ───────────────────────────────────────────

describe('Messages slot — boundary', () => {
  it('handles empty message history', async () => {
    const state = await runSubflow({ strategy: fullHistory }, []);
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    expect(messages).toHaveLength(0);
  });

  it('persistent mode with empty store returns current messages', async () => {
    const store = createTestStore([]);
    const state = await runSubflow(
      { strategy: fullHistory, store, conversationId: 'empty' },
      [user('hello')],
    );
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello');
  });

  it('persistent mode store returns null', async () => {
    const store = {
      load: vi.fn(async () => null),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const state = await runSubflow(
      { strategy: fullHistory, store, conversationId: 'missing' },
      [user('hello')],
    );
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    expect(messages).toHaveLength(1);
  });
});

// ── Scenario Tests ───────────────────────────────────────────

describe('Messages slot — scenario', () => {
  it('sliding window trims old messages from persistent history', async () => {
    const store = createTestStore([
      user('turn1'), assistant('resp1'),
      user('turn2'), assistant('resp2'),
      user('turn3'), assistant('resp3'),
    ]);
    const state = await runSubflow(
      {
        strategy: slidingWindow({ maxMessages: 3 }),
        store,
        conversationId: 'test-conv',
      },
      [user('turn4')],
    );
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    // 6 stored + 1 new = 7 total → window keeps 3 most recent non-system
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('turn3');
    expect(messages[1].content).toBe('resp3');
    expect(messages[2].content).toBe('turn4');
  });

  it('persistent mode tracks stored history for CommitMemory', async () => {
    const store = createTestStore([user('old'), assistant('resp')]);
    const state = await runSubflow(
      {
        strategy: slidingWindow({ maxMessages: 2 }),
        store,
        conversationId: 'test-conv',
      },
      [user('new')],
    );
    const stored = state[MEMORY_PATHS.STORED_HISTORY] as Message[];
    expect(stored).toHaveLength(3);
    const prepared = state[MEMORY_PATHS.PREPARED_MESSAGES] as Message[];
    expect(prepared).toHaveLength(2);
  });

  it('preserves system messages through sliding window', async () => {
    const state = await runSubflow(
      { strategy: slidingWindow({ maxMessages: 2 }) },
      [system('sys'), user('a'), assistant('b'), user('c'), assistant('d'), user('e')],
    );
    const messages = state[AGENT_PATHS.MESSAGES] as Message[];
    expect(messages[0].role).toBe('system');
    expect(messages).toHaveLength(3); // system + 2 most recent
  });
});

// ── Property Tests ───────────────────────────────────────────

describe('Messages slot — property', () => {
  it('output messages is always an array', async () => {
    const state = await runSubflow({ strategy: fullHistory }, []);
    expect(Array.isArray(state[AGENT_PATHS.MESSAGES])).toBe(true);
  });

  it('strategy receives full history before trimming', async () => {
    const spy = vi.fn((history: Message[]) => history);
    const strategy: MessageStrategy = { prepare: spy };
    const msgs = [user('a'), user('b'), user('c')];

    await runSubflow({ strategy }, msgs);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toHaveLength(3);
  });
});

// ── Security Tests ───────────────────────────────────────────

describe('Messages slot — security', () => {
  it('throws at build time when strategy is missing', () => {
    expect(() => buildMessagesSubflow({ strategy: undefined as any }))
      .toThrow('strategy is required');
  });

  it('throws at build time when store provided without conversationId', () => {
    const store = createTestStore();
    expect(() => buildMessagesSubflow({ strategy: fullHistory, store }))
      .toThrow('conversationId is required when store is provided');
  });

  it('store.load() throwing propagates as error', async () => {
    const store = {
      load: vi.fn(async () => { throw new Error('DB connection failed'); }),
      save: vi.fn(),
      clear: vi.fn(),
    };
    await expect(
      runSubflow({ strategy: fullHistory, store, conversationId: 'fail' }, [user('hi')]),
    ).rejects.toThrow('DB connection failed');
  });

  it('strategy.prepare() throwing propagates as error', async () => {
    const failStrategy: MessageStrategy = {
      prepare: () => { throw new Error('strategy crashed'); },
    };
    await expect(
      runSubflow({ strategy: failStrategy }, [user('hi')]),
    ).rejects.toThrow('strategy crashed');
  });
});
