/**
 * Sample 05: Message Strategies
 *
 * Control what the LLM sees from conversation history.
 * Strategies transform the message array before each LLM call.
 *
 *   fullHistory        → send everything (short conversations)
 *   slidingWindow      → keep last N messages
 *   charBudget         → fit within character limit
 *   summaryStrategy    → compress old messages
 *   persistentHistory  → store/load across sessions
 *   withToolPairSafety → prevent orphaned tool results
 *   compositeMessages  → chain strategies
 */
import { describe, it, expect } from 'vitest';
import { userMessage, assistantMessage, systemMessage } from '../../src';
import {
  fullHistory,
  slidingWindow,
  charBudget,
  summaryStrategy,
  persistentHistory,
  InMemoryStore,
  withToolPairSafety,
  compositeMessages,
} from '../../src/providers';

const msgCtx = { message: 'hi', turnNumber: 0, loopIteration: 0 };

describe('Sample 05: Message Strategies', () => {
  it('slidingWindow — keeps last N messages', () => {
    const strategy = slidingWindow({ maxMessages: 3 });
    const history = [
      userMessage('msg 1'),
      assistantMessage('resp 1'),
      userMessage('msg 2'),
      assistantMessage('resp 2'),
      userMessage('msg 3'),
    ];

    const result = strategy.prepare(history, msgCtx);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('msg 2'); // oldest kept
  });

  it('slidingWindow — preserves system messages', () => {
    const strategy = slidingWindow({ maxMessages: 2 });
    const history = [
      systemMessage('You are helpful.'),
      userMessage('old'),
      assistantMessage('old reply'),
      userMessage('new'),
    ];

    const result = strategy.prepare(history, msgCtx);
    expect(result[0].role).toBe('system'); // always kept
    expect(result).toHaveLength(3); // system + 2 recent
  });

  it('summaryStrategy — compresses old messages', async () => {
    const strategy = summaryStrategy({
      keepLast: 2,
      summarize: (msgs) => `[Summary: ${msgs.length} older messages about greetings]`,
    });

    const history = [
      userMessage('Hello'),
      assistantMessage('Hi!'),
      userMessage('How are you?'),
      assistantMessage('Great!'),
      userMessage('What is AI?'),
      assistantMessage('AI is...'),
    ];

    const result = await strategy.prepare(history, msgCtx);

    // Summary + last 2 messages
    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('Summary: 4 older messages');
    expect(result[1].content).toBe('What is AI?');
    expect(result[2].content).toBe('AI is...');
  });

  it('persistentHistory — stores across sessions', async () => {
    const store = new InMemoryStore();

    // Session 1
    const s1 = persistentHistory({ conversationId: 'chat-1', store });
    await s1.prepare([userMessage('Hello'), assistantMessage('Hi!')], msgCtx);

    // Session 2 — picks up where session 1 left off
    const s2 = persistentHistory({ conversationId: 'chat-1', store });
    const result = await s2.prepare(
      [userMessage('Hello'), assistantMessage('Hi!'), userMessage('Follow up')],
      msgCtx,
    );

    expect(result).toHaveLength(3);
    expect(result[2].content).toBe('Follow up');
  });

  it('compositeMessages — chains strategies', async () => {
    // Summarize old → then sliding window → then tool pair safety
    const strategy = compositeMessages([
      summaryStrategy({
        keepLast: 4,
        summarize: (msgs) => `Summary of ${msgs.length} messages`,
      }),
      slidingWindow({ maxMessages: 3 }),
    ]);

    const history = [
      systemMessage('System.'),
      ...Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0 ? userMessage(`u${i}`) : assistantMessage(`a${i}`),
      ),
    ];

    const result = await strategy.prepare(history, msgCtx);
    // System messages preserved, everything else trimmed by both strategies
    expect(result.length).toBeLessThanOrEqual(6);
  });
});
