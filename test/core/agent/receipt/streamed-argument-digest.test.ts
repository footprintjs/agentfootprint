import { describe, expect, it } from 'vitest';
import { messageDigestInput } from '../../../../src/core/agent/receipt/receipt.js';
import type { LLMMessage } from '../../../../src/adapters/types.js';

describe('stream argument recovery participates in request identity', () => {
  const ordinary: LLMMessage = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'one', name: 'lookup', args: {} }],
  };
  it('preserves the prior digest input of ordinary messages', () => {
    expect(messageDigestInput(ordinary)).toBe(
      'assistant\u001e\u001e\u001e\u001eone\u001dlookup\u001d{}\u001d\u001e',
    );
    expect(
      messageDigestInput({ role: 'tool', content: 'ok', toolCallId: 'one', toolName: 'lookup' }),
    ).toBe('tool\u001eok\u001eone\u001elookup\u001e\u001e');
  });
  it('distinguishes a refused tool call from valid empty arguments and other failures', () => {
    const marked = (reason: 'invalid-json' | 'incomplete-stream'): LLMMessage => ({
      ...ordinary,
      toolCalls: [{ id: 'one', name: 'lookup', args: {}, argumentsFailure: { reason } }],
    });
    expect(messageDigestInput(marked('invalid-json'))).not.toBe(messageDigestInput(ordinary));
    expect(messageDigestInput(marked('invalid-json'))).not.toBe(
      messageDigestInput(marked('incomplete-stream')),
    );
  });
  it('distinguishes a recovery text result from a protocol tool result', () => {
    const result: LLMMessage = {
      role: 'tool',
      content: 'refused',
      toolCallId: 'one',
      toolName: 'lookup',
    };
    expect(
      messageDigestInput({ ...result, toolArgumentsFailure: { reason: 'invalid-json' } }),
    ).not.toBe(messageDigestInput(result));
  });
});
