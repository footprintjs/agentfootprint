import { describe, it, expect } from 'vitest';
import {
  fullHistory,
  slidingWindow,
  charBudget,
  withToolPairSafety,
} from '../../../src/providers/messages';
import type { MessageContext } from '../../../src/core';
import type { Message } from '../../../src/types';

const baseCtx: MessageContext = { message: 'hi', turnNumber: 0, loopIteration: 0 };

function msgs(...contents: string[]): Message[] {
  return contents.map((c, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: c,
  }));
}

function withSystem(system: string, rest: Message[]): Message[] {
  return [{ role: 'system' as const, content: system }, ...rest];
}

// ── fullHistory ─────────────────────────────────────────────

describe('fullHistory', () => {
  it('returns all messages unchanged', () => {
    const strategy = fullHistory();
    const input = msgs('hello', 'hi', 'how are you?', 'good');
    expect(strategy.prepare(input, baseCtx)).toEqual(input);
  });

  it('handles empty history', () => {
    expect(fullHistory().prepare([], baseCtx)).toEqual([]);
  });

  it('preserves message order and types', () => {
    const input: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'hi',
        toolCalls: [{ id: '1', name: 'search', arguments: { q: 'test' } }],
      },
      { role: 'tool', content: 'result', toolCallId: '1' },
      { role: 'assistant', content: 'found it' },
    ];
    const result = fullHistory().prepare(input, baseCtx);
    expect(result).toHaveLength(5);
    expect(result[0].role).toBe('system');
    expect(result[2].role).toBe('assistant');
    expect(result[3].role).toBe('tool');
  });
});

// ── slidingWindow ───────────────────────────────────────────

describe('slidingWindow', () => {
  it('keeps last N messages', () => {
    const strategy = slidingWindow({ maxMessages: 2 });
    const input = msgs('a', 'b', 'c', 'd', 'e');
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('d');
    expect(result[1].content).toBe('e');
  });

  it('preserves system messages outside window', () => {
    const strategy = slidingWindow({ maxMessages: 2 });
    const input = withSystem('You are helpful.', msgs('a', 'b', 'c', 'd'));
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('system');
    expect(result[1].content).toBe('c');
    expect(result[2].content).toBe('d');
  });

  it('returns all when under window size', () => {
    const strategy = slidingWindow({ maxMessages: 10 });
    const input = msgs('a', 'b');
    expect(strategy.prepare(input, baseCtx)).toEqual(input);
  });

  it('window of 1 keeps only the last message', () => {
    const strategy = slidingWindow({ maxMessages: 1 });
    const input = msgs('first', 'second', 'third');
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('third');
  });

  it('handles multiple system messages', () => {
    const strategy = slidingWindow({ maxMessages: 1 });
    const input: Message[] = [
      { role: 'system', content: 'System 1' },
      { role: 'system', content: 'System 2' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('System 1');
    expect(result[1].content).toBe('System 2');
    expect(result[2].content).toBe('c');
  });
});

// ── charBudget ──────────────────────────────────────────────

describe('charBudget', () => {
  it('keeps messages within character budget', () => {
    const strategy = charBudget({ maxChars: 10 });
    const input = msgs('a', 'b', 'c', 'd', 'e');
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(5);
  });

  it('drops oldest messages when over budget', () => {
    const strategy = charBudget({ maxChars: 6 });
    const input: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'bye' },
    ];
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('hi');
    expect(result[1].content).toBe('bye');
  });

  it('system messages count toward budget but are always kept', () => {
    const strategy = charBudget({ maxChars: 15 });
    const input: Message[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'bb' },
    ];
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1].content).toBe('bb');
  });

  it('handles empty history', () => {
    expect(charBudget({ maxChars: 100 }).prepare([], baseCtx)).toEqual([]);
  });

  it('keeps nothing when budget is 0 (except system)', () => {
    const strategy = charBudget({ maxChars: 0 });
    const input = withSystem('sys', msgs('a', 'b'));
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
  });
});

// ── withToolPairSafety ──────────────────────────────────────

describe('withToolPairSafety', () => {
  it('removes orphaned tool results when assistant message was truncated', () => {
    const strategy = withToolPairSafety(slidingWindow({ maxMessages: 2 }));
    const input: Message[] = [
      { role: 'user', content: 'search for cats' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'search', arguments: { q: 'cats' } }],
      },
      { role: 'tool', content: 'found cats', toolCallId: 'tc1' },
      { role: 'assistant', content: 'I found cats!' },
      { role: 'user', content: 'thanks' },
    ];
    // slidingWindow(2) keeps: ['I found cats!', 'thanks']
    // 'tool' message for tc1 is not in window, so no orphan issue
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.role !== 'tool')).toBe(true);
  });

  it('removes orphaned tool results when only tool result survives window', () => {
    const strategy = withToolPairSafety(slidingWindow({ maxMessages: 3 }));
    const input: Message[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: {} }] },
      { role: 'tool', content: 'result1', toolCallId: 'tc1' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ];
    // slidingWindow(3): keeps [tool:result1, assistant:answer, user:second]
    // tool:result1 is orphaned (assistant with tc1 was dropped)
    const result = strategy.prepare(input, baseCtx);
    expect(result.find((m) => m.role === 'tool')).toBeUndefined();
  });

  it('preserves complete tool-call/result pairs', () => {
    const strategy = withToolPairSafety(fullHistory());
    const input: Message[] = [
      { role: 'user', content: 'search' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: {} }] },
      { role: 'tool', content: 'found', toolCallId: 'tc1' },
      { role: 'assistant', content: 'here are results' },
    ];
    const result = strategy.prepare(input, baseCtx);
    expect(result).toHaveLength(4);
    expect(result[1].role).toBe('assistant');
    expect(result[2].role).toBe('tool');
  });

  it('removes assistant toolCall messages whose results were dropped', () => {
    // Custom strategy that drops tool messages
    const dropTools: import('../../../src/core').MessageStrategy = {
      prepare: (history) => history.filter((m) => m.role !== 'tool'),
    };
    const strategy = withToolPairSafety(dropTools);
    const input: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: {} }] },
      { role: 'tool', content: 'result', toolCallId: 'tc1' },
      { role: 'assistant', content: 'done' },
    ];
    const result = strategy.prepare(input, baseCtx);
    // Both the tool result AND the assistant toolCall message should be gone
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'hi' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'done' });
  });

  it('works with async strategies', async () => {
    const asyncStrategy: import('../../../src/core').MessageStrategy = {
      prepare: async (history) => history.slice(-1),
    };
    const strategy = withToolPairSafety(asyncStrategy);
    const input: Message[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'x', arguments: {} }] },
      { role: 'tool', content: 'r', toolCallId: 'tc1' },
    ];
    const result = await strategy.prepare(input, baseCtx);
    // Only tool result kept, but its parent was dropped → orphan removed
    expect(result).toHaveLength(0);
  });
});
