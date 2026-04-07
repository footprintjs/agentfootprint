import { describe, it, expect } from 'vitest';
import {
  appendMessage,
  lastMessage,
  lastAssistantMessage,
  lastMessageHasToolCalls,
  userMessage,
  assistantMessage,
  systemMessage,
} from '../../src/test-barrel';
import { slidingWindow, charBudget } from '../../src/providers/messages';
import type { Message } from '../../src/test-barrel';

describe('conversationHelpers', () => {
  describe('appendMessage', () => {
    it('appends a message to the array', () => {
      const msgs: Message[] = [userMessage('Hi')];
      const result = appendMessage(msgs, assistantMessage('Hello'));
      expect(result).toHaveLength(2);
      expect(result[1].content).toBe('Hello');
    });

    it('does not mutate original array', () => {
      const msgs: Message[] = [userMessage('Hi')];
      appendMessage(msgs, assistantMessage('Hello'));
      expect(msgs).toHaveLength(1);
    });
  });

  describe('lastMessage', () => {
    it('returns the last message', () => {
      const msgs: Message[] = [userMessage('A'), assistantMessage('B')];
      expect(lastMessage(msgs)?.content).toBe('B');
    });

    it('returns undefined for empty array', () => {
      expect(lastMessage([])).toBeUndefined();
    });
  });

  describe('lastAssistantMessage', () => {
    it('returns the last assistant message', () => {
      const msgs: Message[] = [
        assistantMessage('First'),
        userMessage('Q'),
        assistantMessage('Second'),
      ];
      expect(lastAssistantMessage(msgs)?.content).toBe('Second');
    });

    it('returns undefined when no assistant messages', () => {
      expect(lastAssistantMessage([userMessage('Hi')])).toBeUndefined();
    });
  });

  describe('lastMessageHasToolCalls', () => {
    it('returns true when last assistant has tool calls', () => {
      const msgs: Message[] = [assistantMessage('', [{ id: '1', name: 'x', arguments: {} }])];
      expect(lastMessageHasToolCalls(msgs)).toBe(true);
    });

    it('returns false when last assistant has no tool calls', () => {
      expect(lastMessageHasToolCalls([assistantMessage('Hi')])).toBe(false);
    });
  });

  describe('slidingWindow (MessageStrategy)', () => {
    it('keeps all messages when under window size', () => {
      const msgs: Message[] = [userMessage('A'), assistantMessage('B')];
      const result = slidingWindow({ maxMessages: 5 }).prepare(msgs);
      expect(result.value).toEqual(msgs);
    });

    it('preserves system message and keeps last N', () => {
      const msgs: Message[] = [
        systemMessage('System'),
        userMessage('A'),
        assistantMessage('B'),
        userMessage('C'),
        assistantMessage('D'),
      ];
      const result = slidingWindow({ maxMessages: 2 }).prepare(msgs);
      expect(result.value).toHaveLength(3); // system + 2 recent
      expect(result.value[0].role).toBe('system');
      expect(result.value[1].content).toBe('C');
      expect(result.value[2].content).toBe('D');
    });
  });

  describe('charBudget (MessageStrategy)', () => {
    it('keeps all messages when under budget', () => {
      const msgs: Message[] = [userMessage('Hi'), assistantMessage('Hey')];
      const result = charBudget({ maxChars: 1000 }).prepare(msgs);
      expect(result.value).toEqual(msgs);
    });

    it('keeps most recent messages within budget', () => {
      const msgs: Message[] = [
        systemMessage('S'),
        userMessage('A'.repeat(100)),
        assistantMessage('B'.repeat(100)),
        userMessage('C'.repeat(50)),
      ];
      const result = charBudget({ maxChars: 55 }).prepare(msgs);
      expect(result.value).toHaveLength(2); // system + last
      expect(result.value[0].role).toBe('system');
      expect(result.value[1].content).toBe('C'.repeat(50));
    });
  });
});
