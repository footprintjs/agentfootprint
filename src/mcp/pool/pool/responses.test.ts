import { describe, expect, it } from 'vitest';

import { isServerAnswer } from './responses.js';

describe('the server response evidence boundary', () => {
  it('reads a cloned JSON-RPC error while leaving the original body available to the SDK', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 7, error: { code: -32001 } });
    const response = new Response(body, { status: 404 });

    await expect(isServerAnswer(response)).resolves.toBe(true);
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).resolves.toBe(body);
  });

  it.each([
    ['intermediary HTML', '<h1>Not found</h1>'],
    ['ordinary JSON', JSON.stringify({ error: { code: 404 } })],
    ['successful RPC answer', JSON.stringify({ jsonrpc: '2.0', result: {} })],
    ['string error code', JSON.stringify({ jsonrpc: '2.0', error: { code: '-1' } })],
    ['null', 'null'],
    ['malformed JSON', '{'],
  ])('does not classify %s as the server error', async (_name, body) => {
    await expect(isServerAnswer(new Response(body, { status: 404 }))).resolves.toBe(false);
  });

  it('retains the existing classification without requiring an RPC id', async () => {
    const response = new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -1 } }));
    await expect(isServerAnswer(response)).resolves.toBe(true);
  });

  it('does not turn an already-consumed body into server evidence', async () => {
    const response = new Response('{"jsonrpc":"2.0","error":{"code":-1}}');
    await response.text();
    await expect(isServerAnswer(response)).resolves.toBe(false);
  });

  it('does not turn a failed cloned body read into server evidence', async () => {
    const response = {
      clone: () => ({ text: () => Promise.reject(new Error('unreadable')) }),
    } as unknown as Response;
    await expect(isServerAnswer(response)).resolves.toBe(false);
  });
});
