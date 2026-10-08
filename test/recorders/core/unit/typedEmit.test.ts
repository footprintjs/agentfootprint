/**
 * Unit tests — typedEmit helper.
 *
 * A stage's scope belongs to a run. A run with no policy (a scope tied as
 * such) emits the payload as made; a scope nothing tied is a run whose state
 * is unknown, and its payload is refused — the placeholder, fail closed.
 */

import { describe, it, expect, vi } from 'vitest';
import { typedEmit } from '../../../../src/recorders/core/typedEmit.js';
import { noPolicyScope } from '../../../helpers/noPolicy.js';

describe('typedEmit', () => {
  it('calls scope.$emit with the given name and payload', () => {
    const scope = noPolicyScope({ $emit: vi.fn() });
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
    const scope = noPolicyScope({ $emit: vi.fn() });
    const payload = {
      toolName: 't',
      toolCallId: 'c1',
      args: { q: 'hi' },
    };
    typedEmit(scope, 'agentfootprint.stream.tool_start', payload);
    expect(scope.$emit.mock.calls[0][1]).toBe(payload);
  });

  it('a scope no run made (its run unknown) emits the placeholder — never the payload', () => {
    const scope = { $emit: vi.fn() };
    typedEmit(scope, 'agentfootprint.stream.tool_start', {
      toolName: 't',
      toolCallId: 'c1',
      args: { ssn: 'SSN-UNTIED-8500' },
    });
    expect(scope.$emit.mock.calls[0][0]).toBe('agentfootprint.stream.tool_start');
    expect(scope.$emit.mock.calls[0][1]).toBe('[REDACTED]');
  });
});
