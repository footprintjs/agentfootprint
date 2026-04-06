import { describe, it, expect } from 'vitest';
import {
  appendMessage,
  slidingWindow,
  userMessage,
  assistantMessage,
  systemMessage,
  ToolRegistry,
  defineTool,
} from '../../src/test-barrel';
import type { Message } from '../../src/test-barrel';

/**
 * Property-based tests: invariants that must hold for any input.
 */
describe('Property: Message invariants', () => {
  it('appendMessage always increases length by 1', () => {
    for (let n = 0; n < 50; n++) {
      const msgs: Message[] = Array.from({ length: n }, (_, i) => userMessage(`msg-${i}`));
      const result = appendMessage(msgs, assistantMessage('new'));
      expect(result.length).toBe(msgs.length + 1);
    }
  });

  it('appendMessage never mutates the original array', () => {
    for (let n = 0; n < 20; n++) {
      const msgs: Message[] = Array.from({ length: n }, (_, i) => userMessage(`msg-${i}`));
      const originalLength = msgs.length;
      appendMessage(msgs, assistantMessage('new'));
      expect(msgs.length).toBe(originalLength);
    }
  });

  it('slidingWindow always preserves system messages', () => {
    for (let windowSize = 1; windowSize <= 10; windowSize++) {
      const msgs: Message[] = [
        systemMessage('System'),
        ...Array.from({ length: 20 }, (_, i) => userMessage(`msg-${i}`)),
      ];
      const result = slidingWindow(msgs, windowSize);
      expect(result[0].role).toBe('system');
    }
  });

  it('slidingWindow result never exceeds windowSize + system count', () => {
    for (let windowSize = 1; windowSize <= 15; windowSize++) {
      const msgs: Message[] = [
        systemMessage('Sys'),
        ...Array.from({ length: 30 }, (_, i) =>
          i % 2 === 0 ? userMessage(`u-${i}`) : assistantMessage(`a-${i}`),
        ),
      ];
      const result = slidingWindow(msgs, windowSize);
      // Result should be at most: system messages + windowSize
      expect(result.length).toBeLessThanOrEqual(windowSize + 1);
    }
  });

  it('slidingWindow is identity when messages fit within window', () => {
    const msgs: Message[] = [userMessage('A'), assistantMessage('B')];
    for (let windowSize = 2; windowSize <= 10; windowSize++) {
      const result = slidingWindow(msgs, windowSize);
      expect(result).toEqual(msgs);
    }
  });
});

describe('Property: ToolRegistry invariants', () => {
  it('formatForLLM output length equals registered tool count', () => {
    for (let n = 1; n <= 20; n++) {
      const registry = new ToolRegistry();
      for (let i = 0; i < n; i++) {
        registry.register(
          defineTool({
            id: `tool-${i}`,
            description: `Tool ${i}`,
            inputSchema: {},
            handler: async () => ({ content: 'ok' }),
          }),
        );
      }
      expect(registry.formatForLLM().length).toBe(n);
      expect(registry.size).toBe(n);
    }
  });
});
