import { describe, it, expect, vi } from 'vitest';
import { systemMessage, userMessage, assistantMessage } from '../../src/test-barrel';
import type { Message, MessageContext } from '../../src/test-barrel';
import {
  summaryStrategy,
  compositeMessages,
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

// Legacy persistentHistory strategy + its in-file InMemoryStore were
// removed when the library moved to a single memory path via
// `agentfootprint/memory`. Durable conversation history is now owned
// by `MemoryPipeline.write` + `MemoryStore.putMany`.
