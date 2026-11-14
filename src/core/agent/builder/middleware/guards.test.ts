import { describe, expect, it } from 'vitest';
import { assertMiddleware, assertToolMiddleware } from './guards.js';

describe('middleware declaration guards', () => {
  it('accepts either tool hook and refuses a named but inactive link', () => {
    expect(() => assertToolMiddleware({ name: 'call', onToolCall() {} })).not.toThrow();
    expect(() => assertToolMiddleware({ name: 'result', onToolResult() {} })).not.toThrow();
    expect(() => assertToolMiddleware({ name: 'inactive' })).toThrow('at least one');
    expect(() => assertToolMiddleware({ name: '', onToolCall() {} })).toThrow('cannot be blank');
  });

  it('checks the requested message hook rather than accepting an unrelated hook', () => {
    expect(() =>
      assertMiddleware({ name: 'message', onMessage() {} }, 'messageMiddleware', 'onMessage'),
    ).not.toThrow();
    expect(() =>
      assertMiddleware({ name: 'tool', onToolCall() {} }, 'messageMiddleware', 'onMessage'),
    ).toThrow('AgentBuilder.messageMiddleware');
  });
});
