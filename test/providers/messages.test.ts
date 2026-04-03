import { describe, it, expect, vi } from 'vitest';
import { systemMessage, userMessage, assistantMessage } from '../../src';
import type { Message, MessageContext } from '../../src';
import {
  summaryStrategy,
  compositeMessages,
  persistentHistory,
  InMemoryStore,
  slidingWindow,
  withToolPairSafety,
  fullHistory,
} from '../../src/providers';

// ── Helpers ─────────────────────────────────────────────────

function msgCtx(overrides: Partial<MessageContext> = {}): MessageContext {
  return {
    message: 'hello',
    turnNumber: 0,
    loopIteration: 0,
    ...overrides,
  };
}

function conversation(n: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < n; i++) {
    msgs.push(i % 2 === 0 ? userMessage(`user-${i}`) : assistantMessage(`asst-${i}`));
  }
  return msgs;
}

// ── summaryStrategy ─────────────────────────────────────────

describe('summaryStrategy', () => {
  it('summarizes old messages and keeps recent ones', async () => {
    const strategy = summaryStrategy({
      keepLast: 2,
      summarize: (msgs) => `Summary of ${msgs.length} messages`,
    });

    const history = [systemMessage('System.'), ...conversation(6)];

    const decision = await strategy.prepare(history, msgCtx());
    const result = decision.value;

    // System + summary + last 2
    expect(result.length).toBe(4);
    expect(result[0].content).toBe('System.');
    expect(result[1].role).toBe('system');
    expect(result[1].content).toBe('Summary of 4 messages');
    expect(result[2].content).toBe('user-4');
    expect(result[3].content).toBe('asst-5');
  });

  it('returns history unchanged when within keepLast', async () => {
    const summarize = vi.fn(() => 'summary');
    const strategy = summaryStrategy({ keepLast: 10, summarize });

    const history = conversation(4);
    const decision = await strategy.prepare(history, msgCtx());

    expect(decision.value).toEqual(history);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('supports async summarizer', async () => {
    const strategy = summaryStrategy({
      keepLast: 2,
      summarize: async (msgs) => `Async summary of ${msgs.length}`,
    });

    const decision = await strategy.prepare(conversation(6), msgCtx());
    expect(decision.value[0].content).toBe('Async summary of 4');
  });

  it('skips summary when summarizer returns empty string', async () => {
    const strategy = summaryStrategy({
      keepLast: 2,
      summarize: () => '',
    });

    const decision = await strategy.prepare(conversation(6), msgCtx());
    // Just the last 2, no summary message
    expect(decision.value.length).toBe(2);
  });
});

// ── compositeMessages ───────────────────────────────────────

describe('compositeMessages', () => {
  it('chains strategies in order (pipeline)', async () => {
    // First summarize, then apply sliding window
    const strategy = compositeMessages([
      summaryStrategy({
        keepLast: 4,
        summarize: (msgs) => `Summary of ${msgs.length}`,
      }),
      slidingWindow({ maxMessages: 3 }),
    ]);

    const history = [systemMessage('System.'), ...conversation(8)];

    const decision = await strategy.prepare(history, msgCtx());
    const result = decision.value;

    // After summary: system + summary_system + 4 kept = 6 messages
    // After sliding window (maxMessages: 3 non-system): system + summary + last 3
    expect(result.length).toBe(5); // 2 system + 3 non-system
    expect(result[0].content).toBe('System.');
    expect(result[1].role).toBe('system'); // summary
  });

  it('empty chain returns history unchanged', async () => {
    const strategy = compositeMessages([]);
    const history = conversation(4);
    const decision = await strategy.prepare(history, msgCtx());
    expect(decision.value).toEqual(history);
  });

  it('single strategy works like calling it directly', async () => {
    const strategy = compositeMessages([slidingWindow({ maxMessages: 2 })]);

    const history = conversation(6);
    const decision = await strategy.prepare(history, msgCtx());
    expect(decision.value.length).toBe(2);
  });
});

// ── persistentHistory ───────────────────────────────────────

describe('persistentHistory', () => {
  it('stores and loads conversation across calls', async () => {
    const store = new InMemoryStore();
    const strategy = persistentHistory({ conversationId: 'conv-1', store });

    // First call — no stored history
    const history1 = [userMessage('Hello'), assistantMessage('Hi!')];
    const decision1 = await strategy.prepare(history1, msgCtx());
    expect(decision1.value).toEqual(history1);

    // Second call — stored history is merged with new messages
    const history2 = [userMessage('Hello'), assistantMessage('Hi!'), userMessage('How are you?')];
    const decision2 = await strategy.prepare(history2, msgCtx());
    expect(decision2.value.length).toBe(3);
    expect(decision2.value[2].content).toBe('How are you?');
  });

  it('separate conversations are isolated', async () => {
    const store = new InMemoryStore();
    const s1 = persistentHistory({ conversationId: 'a', store });
    const s2 = persistentHistory({ conversationId: 'b', store });

    await s1.prepare([userMessage('A')], msgCtx());
    await s2.prepare([userMessage('B')], msgCtx());

    const loaded1 = await store.load('a');
    const loaded2 = await store.load('b');

    expect(loaded1[0].content).toBe('A');
    expect(loaded2[0].content).toBe('B');
  });

  it('InMemoryStore.clear empties all conversations', async () => {
    const store = new InMemoryStore();
    await store.save('conv-1', [userMessage('test')]);
    store.clear();
    expect(await store.load('conv-1')).toEqual([]);
  });

  it('returns empty stored for unknown conversation', async () => {
    const store = new InMemoryStore();
    const strategy = persistentHistory({ conversationId: 'new', store });

    const history = [userMessage('Fresh start')];
    const decision = await strategy.prepare(history, msgCtx());
    expect(decision.value).toEqual(history);
  });

  it('composes with other strategies via compositeMessages', async () => {
    const store = new InMemoryStore();
    const strategy = compositeMessages([
      persistentHistory({ conversationId: 'conv-1', store }),
      slidingWindow({ maxMessages: 3 }),
    ]);

    const history = conversation(6);
    const decision = await strategy.prepare(history, msgCtx());
    expect(decision.value.length).toBe(3); // sliding window keeps 3
  });
});
