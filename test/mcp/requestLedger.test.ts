/**
 * The request ledger — which tool call an MCP request belongs to.
 *
 *   P1 Unit      — a ticket issued on a params object is claimed by the body of
 *                  the one request the SDK sends with those params, while that
 *                  send runs, and never after
 *   P5 Security  — nothing else claims it: a response or a notification with the
 *                  same id, another method, a second message reusing the params
 *   P1 Unit      — the watched transport is the transport: every other property
 *                  and method passes through
 *
 * The SDK half of the seam — that the MCP SDK hands the transport the very
 * params object `callTool` was given — is pinned end to end by
 * `requestEvidence.test.ts`, through the real SDK.
 */

import { describe, expect, it } from 'vitest';

import { RequestLedger, type RequestTicket } from '../../src/mcp/requestLedger.js';

const ticket = (): RequestTicket => ({ sink: { file: () => undefined } });

/** A transport stand-in: `send` resolves when told to, and records what it saw. */
function transport() {
  const sent: unknown[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const target = {
    onmessage: undefined as unknown,
    started: false,
    start(): Promise<void> {
      this.started = true;
      return Promise.resolve();
    },
    send(message: unknown): Promise<void> {
      sent.push(message);
      return held;
    },
  };
  return { target, sent, release: () => release() };
}

const call = (id: number | string, params: object) => ({
  jsonrpc: '2.0',
  method: 'tools/call',
  params,
  id,
});

describe('request ledger — P1 one ticket, one request, while it is sent', () => {
  it('the body of the request sent with the issued params claims the ticket — until the send settles', async () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = ledger.watch(t.target);
    const params = { name: 'search_tickets', arguments: { q: 'x' } };
    const mine = ticket();
    ledger.issue(params, mine);

    const message = call(7, params);
    const sending = watched.send(message);
    expect(t.sent).toEqual([message]);
    expect(ledger.claim(JSON.stringify(message))).toBe(mine);

    t.release();
    await sending;
    expect(ledger.claim(JSON.stringify(message))).toBeUndefined();
  });

  it('a send that throws at once still lets the ticket go', () => {
    const ledger = new RequestLedger();
    const params = {};
    ledger.issue(params, ticket());
    const watched = ledger.watch({
      send: (_message: unknown): Promise<void> => {
        throw new Error('not connected');
      },
    });
    expect(() => watched.send(call(1, params))).toThrow('not connected');
    expect(ledger.claim(JSON.stringify(call(1, params)))).toBeUndefined();
  });

  it('two calls in flight on one connection each claim their own', () => {
    const ledger = new RequestLedger();
    const watched = ledger.watch(transport().target);
    const [a, b] = [{ q: 'a' }, { q: 'b' }];
    const [ta, tb] = [ticket(), ticket()];
    ledger.issue(a, ta);
    ledger.issue(b, tb);
    void watched.send(call(1, a));
    void watched.send(call(2, b));
    expect(ledger.claim(JSON.stringify(call(1, { q: 'a' })))).toBe(ta);
    expect(ledger.claim(JSON.stringify(call(2, { q: 'b' })))).toBe(tb);
  });
});

describe('request ledger — P5 nothing else claims a ticket', () => {
  it('a response, a notification or another method with the same id claims nothing', () => {
    const ledger = new RequestLedger();
    const watched = ledger.watch(transport().target);
    const params = {};
    ledger.issue(params, ticket());
    void watched.send(call(3, params));

    // A response the client sends the SERVER (an elicitation answer) carries the
    // server's id — the same number can be in flight as one of ours.
    expect(ledger.claim(JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }))).toBeUndefined();
    expect(
      ledger.claim(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' })),
    ).toBeUndefined();
    expect(
      ledger.claim(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })),
    ).toBeUndefined();
    expect(ledger.claim('not json')).toBeUndefined();
    expect(ledger.claim(undefined)).toBeUndefined();
  });

  it('a message that reuses the params binds nothing: one ticket, one request', () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = ledger.watch(t.target);
    const params = {};
    ledger.issue(params, ticket());
    void watched.send(call(1, params));
    void watched.send(call(2, params));
    expect(ledger.claim(JSON.stringify(call(2, {})))).toBeUndefined();
  });

  it('a call with the SAME arguments as an issued one claims nothing: identity, never content', () => {
    // Two calls with identical arguments are the case content matching gets
    // wrong. Only the very params object a call issued can bind its ticket.
    const ledger = new RequestLedger();
    const watched = ledger.watch(transport().target);
    ledger.issue({ q: 'printer' }, ticket());
    void watched.send(call(1, { q: 'printer' }));
    expect(ledger.claim(JSON.stringify(call(1, { q: 'printer' })))).toBeUndefined();
  });
});

describe('request ledger — P1 the watched transport is the transport', () => {
  it('every other property and method passes through to the transport itself', async () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = ledger.watch(t.target);
    const onmessage = (): void => undefined;
    watched.onmessage = onmessage;
    await watched.start();
    expect(t.target.onmessage).toBe(onmessage);
    expect(t.target.started).toBe(true);
    expect(watched.send).not.toBe(t.target.send);
  });
});
