import { describe, expect, it } from 'vitest';

import { isToolCall, passesUnguarded } from './requests.js';

describe('unguarded protocol bodies', () => {
  it.each([
    ['notification', { jsonrpc: '2.0', method: 'notifications/initialized' }, true],
    ['server result', { jsonrpc: '2.0', id: 1, result: {} }, true],
    ['server error', { jsonrpc: '2.0', id: 1, error: { code: -1 } }, true],
    ['request', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, false],
    ['null request id', { jsonrpc: '2.0', id: null, method: 'tools/list' }, false],
    ['batch', [{ jsonrpc: '2.0', method: 'notifications/initialized' }], false],
    ['null', null, false],
    ['primitive', 'notification', false],
    ['empty object', {}, false],
    ['non-string method', { method: 1, result: {} }, false],
    ['result without id or version', { result: null }, true],
    ['notification without version', { method: 'notification' }, true],
  ])('%s retains its existing guard requirement', (_name, message, expected) => {
    expect(passesUnguarded(JSON.stringify(message))).toBe(expected);
  });

  it('requires a JSON string body and refuses malformed JSON', () => {
    expect(passesUnguarded(undefined)).toBe(false);
    expect(passesUnguarded(new URLSearchParams({ method: 'notification' }))).toBe(false);
    expect(passesUnguarded('{')).toBe(false);
  });
});

describe('tool-call detection', () => {
  it.each([
    [{ method: 'tools/call' }, true],
    [{ method: 'tools/list' }, false],
    [{}, false],
    [null, false],
    ['tools/call', false],
    [undefined, false],
  ])('classifies %j', (message, expected) => {
    expect(isToolCall(message)).toBe(expected);
  });

  it('retains object-property detection without adding an array restriction', () => {
    const message = Object.assign([], { method: 'tools/call' });
    expect(isToolCall(message)).toBe(true);
  });
});
