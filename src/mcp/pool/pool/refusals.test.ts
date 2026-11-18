import { describe, expect, it } from 'vitest';

import { McpPoolRefusedError } from '../errors.js';
import { initTimeout, isContextMoved, poolClosed } from './refusals.js';

describe('fixed pool lifetime errors', () => {
  it('creates the original timeout error name and sentence', () => {
    const error = initTimeout();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TimeoutError');
    expect(error.message).toBe('The pooled client did not open within its deadline.');
    expect(initTimeout()).not.toBe(error);
  });

  it('creates the original close error name and sentence', () => {
    const error = poolClosed();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('The MCP client pool was closed.');
    expect(poolClosed()).not.toBe(error);
  });
});

describe('context-moved classification', () => {
  it('recognizes only the canonical binding-changed refusal', () => {
    expect(isContextMoved(new McpPoolRefusedError('binding-changed', 'orders'))).toBe(true);
    expect(isContextMoved(new McpPoolRefusedError('stale-tools', 'orders'))).toBe(false);
    expect(isContextMoved({ reason: 'binding-changed' })).toBe(false);
    expect(isContextMoved(Object.assign(new Error('moved'), { reason: 'binding-changed' }))).toBe(
      false,
    );
    expect(isContextMoved(null)).toBe(false);
  });
});
