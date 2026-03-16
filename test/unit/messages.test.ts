import { describe, it, expect } from 'vitest';
import {
  systemMessage,
  userMessage,
  assistantMessage,
  toolResultMessage,
  hasToolCalls,
} from '../../src';

describe('Message helpers', () => {
  it('creates system message', () => {
    const msg = systemMessage('You are helpful.');
    expect(msg).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('creates user message', () => {
    const msg = userMessage('Hello');
    expect(msg).toEqual({ role: 'user', content: 'Hello' });
  });

  it('creates assistant message without tool calls', () => {
    const msg = assistantMessage('Hi there!');
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('Hi there!');
    expect(msg.toolCalls).toBeUndefined();
  });

  it('creates assistant message with tool calls', () => {
    const toolCalls = [{ id: '1', name: 'search', arguments: { q: 'test' } }];
    const msg = assistantMessage('Let me search.', toolCalls);
    expect(msg.toolCalls).toEqual(toolCalls);
  });

  it('creates tool result message', () => {
    const msg = toolResultMessage('Result here', 'call-1');
    expect(msg).toEqual({ role: 'tool', content: 'Result here', toolCallId: 'call-1' });
  });

  it('hasToolCalls returns true for assistant with tools', () => {
    const msg = assistantMessage('', [{ id: '1', name: 'x', arguments: {} }]);
    expect(hasToolCalls(msg)).toBe(true);
  });

  it('hasToolCalls returns false for assistant without tools', () => {
    expect(hasToolCalls(assistantMessage('Hi'))).toBe(false);
  });

  it('hasToolCalls returns false for non-assistant messages', () => {
    expect(hasToolCalls(userMessage('Hi'))).toBe(false);
    expect(hasToolCalls(systemMessage('Sys'))).toBe(false);
  });

  it('hasToolCalls returns false for empty tool calls array', () => {
    const msg = assistantMessage('Hi', []);
    expect(hasToolCalls(msg)).toBe(false);
  });
});
