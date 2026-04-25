/**
 * Unit tests — typedEmit helper.
 */

import { describe, it, expect, vi } from 'vitest';
import { typedEmit } from '../../../../src/recorders/core/typedEmit.js';

describe('typedEmit', () => {
  it('calls scope.$emit with the given name and payload', () => {
    const scope = { $emit: vi.fn() };
    typedEmit(scope, 'agentfootprint.stream.llm_start', {
      iteration: 1,
      provider: 'mock',
      model: 'm',
      systemPromptChars: 0,
      messagesCount: 0,
      toolsCount: 0,
    });
    expect(scope.$emit).toHaveBeenCalledTimes(1);
    expect(scope.$emit.mock.calls[0][0]).toBe('agentfootprint.stream.llm_start');
    expect(scope.$emit.mock.calls[0][1]).toEqual({
      iteration: 1,
      provider: 'mock',
      model: 'm',
      systemPromptChars: 0,
      messagesCount: 0,
      toolsCount: 0,
    });
  });

  it('preserves payload identity (no defensive clone)', () => {
    const scope = { $emit: vi.fn() };
    const payload = {
      toolName: 't',
      toolCallId: 'c1',
      args: { q: 'hi' },
    };
    typedEmit(scope, 'agentfootprint.stream.tool_start', payload);
    expect(scope.$emit.mock.calls[0][1]).toBe(payload);
  });
});
