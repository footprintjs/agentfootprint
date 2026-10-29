/**
 * The request ledger — which tool call an MCP request belongs to, and when the
 * SDK has given a request up.
 *
 *   P1 Unit      — a ticket issued on a params object rides the one request the
 *                  SDK sends with those params, while that send runs, never after
 *   P5 Security  — nothing else carries it: a response or a notification with the
 *                  same id, another method, a second message reusing the params,
 *                  a call with the same arguments
 *   P3 Scenario  — the SDK's `notifications/cancelled` stops exactly the request
 *                  it names, matched to a call or not
 *   P1 Unit      — `send` is watched IN PLACE: the same object, a `#private`
 *                  class works, every other member is untouched, and a later
 *                  assignment of `send` is refused loudly
 *   P1 Unit      — the counts the dev-mode note reads
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

/** Watch a stand-in, failing the test when the ledger declines to. */
function watchedBy<T extends object>(ledger: RequestLedger, target: T): T {
  const watched = ledger.watch(target);
  expect(watched, 'the ledger declined to watch the transport').toBe(target);
  return watched as T;
}

const call = (id: number | string, params: object) => ({
  jsonrpc: '2.0',
  method: 'tools/call',
  params,
  id,
});

const body = (id: number | string, params: object = {}): string => JSON.stringify(call(id, params));

describe('request ledger — P1 one ticket, one request, while it is sent', () => {
  it('the body of the request sent with the issued params carries the ticket — until the send settles', async () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    const params = { name: 'search_tickets', arguments: { q: 'x' } };
    const mine = ticket();
    ledger.issue(params, mine);

    const message = call(7, params);
    const sending = watched.send(message);
    expect(t.sent).toEqual([message]);
    expect(ledger.claim(body(7, params))?.ticket).toBe(mine);

    t.release();
    await sending;
    expect(ledger.claim(body(7, params))).toBeUndefined();
  });

  it('a send that throws at once still lets the request go', () => {
    const ledger = new RequestLedger();
    const params = {};
    ledger.issue(params, ticket());
    const watched = watchedBy(ledger, {
      send: (_message: unknown): Promise<void> => {
        throw new Error('not connected');
      },
    });
    expect(() => watched.send(call(1, params))).toThrow('not connected');
    expect(ledger.claim(body(1))).toBeUndefined();
  });

  it('two calls in flight on one connection each carry their own', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const [a, b] = [{ q: 'a' }, { q: 'b' }];
    const [ta, tb] = [ticket(), ticket()];
    ledger.issue(a, ta);
    ledger.issue(b, tb);
    void watched.send(call(1, a));
    void watched.send(call(2, b));
    expect(ledger.claim(body(1, { q: 'a' }))?.ticket).toBe(ta);
    expect(ledger.claim(body(2, { q: 'b' }))?.ticket).toBe(tb);
  });
});

describe('request ledger — P5 nothing else carries a ticket', () => {
  it('a response, a notification or another method with the same id claims nothing', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
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

  it('a message that reuses the params carries no ticket: one ticket, one request', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const params = {};
    ledger.issue(params, ticket());
    void watched.send(call(1, params));
    void watched.send(call(2, params));
    expect(ledger.claim(body(1))?.ticket).toBeDefined();
    expect(ledger.claim(body(2))?.ticket).toBeUndefined();
  });

  it('a call with the SAME arguments as an issued one carries no ticket: identity, never content', () => {
    // Two calls with identical arguments are the case content matching gets
    // wrong. Only the very params object a call issued can bind its ticket.
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    ledger.issue({ q: 'printer' }, ticket());
    void watched.send(call(1, { q: 'printer' }));
    expect(ledger.claim(body(1, { q: 'printer' }))?.ticket).toBeUndefined();
  });
});

describe('request ledger — P3 the SDK cancelling a request stops its series', () => {
  it('`notifications/cancelled` aborts exactly the request it names — matched to a call or not', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const matched = {};
    ledger.issue(matched, ticket());
    void watched.send(call(1, matched));
    void watched.send(call(2, { q: 'unmatched — the SDK copied its params' }));
    void watched.send(call(3, { q: 'another' }));
    const [one, two, three] = [1, 2, 3].map((id) => ledger.claim(body(id))?.cancelled);

    void watched.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 2, reason: 'timed out' },
    });

    expect(two?.aborted, 'the request the SDK gave up').toBe(true);
    expect(one?.aborted).toBe(false);
    expect(three?.aborted).toBe(false);
  });
});

describe('request ledger — P1 the transport is watched in place', () => {
  it('the SAME object is returned; every other member is the transport’s own', async () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    const onmessage = (): void => undefined;
    watched.onmessage = onmessage;
    await watched.start();
    expect(watched).toBe(t.target);
    expect(t.target.onmessage).toBe(onmessage);
    expect(t.target.started).toBe(true);
  });

  it('a transport class with `#private` fields still works — its methods run on the instance itself', async () => {
    class Guarded {
      #sent: unknown[] = [];
      send(message: unknown): Promise<void> {
        this.#sent.push(message);
        return Promise.resolve();
      }
      count(): number {
        return this.#sent.length;
      }
    }
    const ledger = new RequestLedger();
    const params = {};
    ledger.issue(params, ticket());
    const guarded = watchedBy(ledger, new Guarded());
    await guarded.send(call(1, params));
    expect(guarded.count()).toBe(1);
  });

  it('assigning `send` again is refused loudly — never silently bypassed', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    expect(() => {
      watched.send = async () => undefined;
    }).toThrow(/request ledger/);
    expect(() => delete (watched as { send?: unknown }).send).toThrow();
  });

  it('a transport with no `send` is not watched', () => {
    expect(new RequestLedger().watch({ start: () => undefined })).toBeUndefined();
  });
});

describe('request ledger — P1 what the dev-mode note reads', () => {
  it('counts every tools/call sent, and knows which tickets a request was bound to', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const [bound, unbound] = [ticket(), ticket()];
    const params = {};
    ledger.issue(params, bound);
    ledger.issue({ copied: 'away' }, unbound);
    void watched.send(call(1, params));
    void watched.send(call(2, { copied: 'away' }));
    void watched.send({ jsonrpc: '2.0', method: 'tools/list', id: 3 });
    expect(ledger.toolCallsSent).toBe(2);
    expect(ledger.wasBound(bound)).toBe(true);
    expect(ledger.wasBound(unbound)).toBe(false);
    expect([ledger.firstUnbound(), ledger.firstUnbound()]).toEqual([true, false]);
  });
});
