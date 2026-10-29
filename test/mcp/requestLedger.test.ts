/**
 * The request ledger — which tool call an MCP request belongs to, when the SDK
 * has given a request up, and whether a request's answer arrived.
 *
 *   P1 Unit      — a call's marker rides the one request the SDK sends with it,
 *                  through a copy of the params, while that send runs, never after
 *   P5 Security  — nothing else carries its ticket: a response or a notification
 *                  with the same id, another method, a second message reusing the
 *                  marker, a call with the same arguments and no marker
 *   P3 Scenario  — the SDK's `notifications/cancelled` stops exactly the request
 *                  it names, matched to a call or not
 *   P1 Unit      — `send` is watched IN PLACE: the same object, a `#private`
 *                  class works, every other member is untouched, and a later
 *                  assignment of `send` is refused loudly
 *   P1 Unit      — the counts the dev-mode note reads
 *   P6 Security  — the marker never reaches the server: the transport sends the
 *                  bytes an unmarked request would have had
 *   P7 Boundary  — under 'app-authorized', a request the ledger cannot match is
 *                  refused at `send`, and nothing is sent
 *   P8 Unit      — the answers are observed only once the `initialize` answer
 *                  passed the observer; a replaced handler never counts
 *   P9 Scenario  — an awaited answer's watch ends by request id: the answer, the
 *                  SDK's cancellation, the call settling, the connection closing;
 *                  never the HTTP send alone; a call ended by the close is not
 *                  named as unmatched
 *
 * The SDK half of the seam — that the MCP SDK carries the params' `_meta` to the
 * transport, through a copy too — is pinned end to end by
 * `requestEvidence.test.ts` and `appAuthorizedReplay.test.ts`, through the real SDK.
 */

import { describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import { openCall } from '../../src/mcp/callLifetime.js';
import { CALL_MARKER_KEY, markParams, takeMarker } from '../../src/mcp/callMarker.js';
import { REQUEST_EVIDENCE } from '../../src/tools/requestEvidence.js';
import { RequestLedger, type RequestTicket } from '../../src/mcp/requestLedger.js';
import { McpReplayUnavailableError } from '../../src/mcp/replayUnavailable.js';

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

describe('request ledger — P1 one marker, one request, while it is sent', () => {
  it('the body of the request sent with the marked params carries the ticket — until the send settles', async () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    const params = { name: 'search_tickets', arguments: { q: 'x' } };
    const mine = ticket();
    const marker = ledger.issue(mine).marker;

    const sending = watched.send(call(7, markParams(params, marker)));
    // The transport is handed the request without the marker.
    expect(t.sent).toEqual([call(7, params)]);
    expect(ledger.claim(body(7, params))?.ticket).toBe(mine);

    t.release();
    await sending;
    expect(ledger.claim(body(7, params))).toBeUndefined();
  });

  it('a COPY of the marked params still carries the ticket: the marker survives what identity does not', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const mine = ticket();
    const marked = markParams(
      { name: 'search_tickets', arguments: { q: 'x' } },
      ledger.issue(mine).marker,
    );
    void watched.send(call(4, structuredClone(marked)));
    expect(ledger.claim(body(4))?.ticket).toBe(mine);
  });

  it('a send that throws at once still lets the request go', () => {
    const ledger = new RequestLedger();
    const marker = ledger.issue(ticket()).marker;
    const watched = watchedBy(ledger, {
      send: (_message: unknown): Promise<void> => {
        throw new Error('not connected');
      },
    });
    expect(() => watched.send(call(1, markParams({}, marker)))).toThrow('not connected');
    expect(ledger.claim(body(1))).toBeUndefined();
  });

  it('two calls in flight on one connection each carry their own', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const [ta, tb] = [ticket(), ticket()];
    const [a, b] = [ledger.issue(ta).marker, ledger.issue(tb).marker];
    void watched.send(call(1, markParams({ q: 'a' }, a)));
    void watched.send(call(2, markParams({ q: 'b' }, b)));
    expect(ledger.claim(body(1, { q: 'a' }))?.ticket).toBe(ta);
    expect(ledger.claim(body(2, { q: 'b' }))?.ticket).toBe(tb);
  });
});

describe('request ledger — P5 nothing else carries a ticket', () => {
  it('a response, a notification or another method with the same id claims nothing', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    void watched.send(call(3, markParams({}, ledger.issue(ticket()).marker)));

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

  it('a message that reuses the marker carries no ticket: one marker, one request', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const params = markParams({}, ledger.issue(ticket()).marker);
    void watched.send(call(1, params));
    void watched.send(call(2, params));
    expect(ledger.claim(body(1))?.ticket).toBeDefined();
    expect(ledger.claim(body(2))?.ticket).toBeUndefined();
  });

  it('a call with the SAME arguments and no marker carries no ticket: the marker, never content', () => {
    // Two calls with identical arguments are the case content matching gets
    // wrong. Only the marker a call was issued can bind its ticket.
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    ledger.issue(ticket());
    void watched.send(call(1, { q: 'printer' }));
    expect(ledger.claim(body(1, { q: 'printer' }))?.ticket).toBeUndefined();
  });

  it('a marker this ledger never issued carries no ticket', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    ledger.issue(ticket());
    void watched.send(call(1, markParams({}, 'call-99')));
    expect(ledger.claim(body(1))?.ticket).toBeUndefined();
  });
});

describe('request ledger — P3 the SDK cancelling a request stops its series', () => {
  it('`notifications/cancelled` aborts exactly the request it names — matched to a call or not', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    void watched.send(call(1, markParams({}, ledger.issue(ticket()).marker)));
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
    const params = markParams({}, ledger.issue(ticket()).marker);
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
  it('counts every tools/call sent, and knows which calls a request was matched to', () => {
    const ledger = new RequestLedger();
    const watched = watchedBy(ledger, transport().target);
    const [matched, unmatched] = [ledger.issue(ticket()), ledger.issue(ticket())];
    void watched.send(call(1, markParams({}, matched.marker)));
    void watched.send(call(2, { rebuilt: 'without its _meta' }));
    void watched.send({ jsonrpc: '2.0', method: 'tools/list', id: 3 });
    expect(ledger.toolCallsSent).toBe(2);
    expect(matched.request?.id).toBe(1);
    expect(unmatched.request).toBeUndefined();
    expect([ledger.firstUnbound(), ledger.firstUnbound()]).toEqual([true, false]);
  });
});

// ─── P6–P9 the marker, the strict refusal, the answer watch ──────────

/** An incoming message, as the transport hands it to whatever `onmessage` it holds. */
function deliver(target: { onmessage: unknown }, message: unknown): void {
  (target.onmessage as (m: unknown) => void)(message);
}

const initialize = { jsonrpc: '2.0', method: 'initialize', id: 0, params: {} };
const initialized = { jsonrpc: '2.0', id: 0, result: {} };

/** A strict ledger over a stand-in whose `initialize` answer passed the observer. */
function strictConnection() {
  const ledger = new RequestLedger({ server: 'tickets', strict: true });
  const t = transport();
  const watched = watchedBy(ledger, t.target);
  void watched.send(initialize);
  deliver(t.target, initialized);
  expect(ledger.answersObserved).toBe(true);
  return { ledger, t, watched };
}

/** The message the MCP SDK hands the transport: its keys in the SDK's order. */
const sdkMessage = (params: object) => ({ method: 'tools/call', params, jsonrpc: '2.0', id: 9 });

describe('request ledger — P6 the marker never reaches the server', () => {
  it('the transport sends the bytes an unmarked request would have had — with and without a `_meta` of its own', () => {
    const plain = { name: 'search_tickets', arguments: { q: 'x' } };
    const timed = { ...plain, _meta: { agentfootprint: { time: { now: '2026-10-29' } } } };
    for (const params of [plain, timed]) {
      const taken = takeMarker(sdkMessage(markParams(params, 'call-1')));
      expect(taken.marker).toBe('call-1');
      expect(JSON.stringify(taken.message)).toBe(JSON.stringify(sdkMessage(params)));
    }
  });

  it("the SDK's own `_meta` entries keep their place; only the marker goes", () => {
    const marked = markParams({ name: 'search_tickets', arguments: {} }, 'call-2') as {
      readonly _meta: Readonly<Record<string, unknown>>;
    };
    // What the SDK does when the call asks for progress: a copy, one more entry.
    const withProgress = { ...marked, _meta: { ...marked._meta, progressToken: 9 } };
    expect(takeMarker(sdkMessage(withProgress)).message).toEqual(
      sdkMessage({ name: 'search_tickets', arguments: {}, _meta: { progressToken: 9 } }),
    );
  });

  it("the SDK's message is never changed in place, and a message with no marker is handed on as it is", () => {
    const message = sdkMessage(markParams({ name: 'search_tickets' }, 'call-3'));
    const before = structuredClone(message);
    takeMarker(message);
    expect(message).toEqual(before);
    const unmarked = sdkMessage({ name: 'search_tickets' });
    expect(takeMarker(unmarked).message).toBe(unmarked);
    expect(takeMarker('not a message').message).toBe('not a message');
  });

  it('through the watched send, the transport never holds the marker', () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    void watched.send(call(1, markParams({ name: 'search_tickets' }, ledger.issue().marker)));
    expect(JSON.stringify(t.sent)).not.toContain(CALL_MARKER_KEY);
  });
});

describe("request ledger — P7 under 'app-authorized', a request it cannot match is never sent", () => {
  it('no marker, a marker never issued, a marker already used: refused, and the transport never sees it', async () => {
    const { ledger, t, watched } = strictConnection();
    const used = markParams({ name: 'search_tickets' }, ledger.issue().marker);
    void watched.send(call(1, used));
    const unmatched = [
      [2, { name: 'search_tickets' }],
      [3, markParams({ name: 'search_tickets' }, 'call-99')],
      [4, used],
    ] as const;
    for (const [id, params] of unmatched) {
      const refused = await watched.send(call(id, params)).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(McpReplayUnavailableError);
      expect(refused).toMatchObject({
        reason: 'request-unmatched',
        server: 'tickets',
        tool: 'search_tickets',
        sent: false,
      });
    }
    // The initialize request and the one matched call — nothing else.
    expect(t.sent).toHaveLength(2);
    expect(ledger.toolCallsSent).toBe(1);
  });

  it('under compatibility, an unmatched request is sent as it always was', () => {
    const ledger = new RequestLedger();
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    void watched.send(call(1, { name: 'search_tickets' }));
    expect(t.sent).toEqual([call(1, { name: 'search_tickets' })]);
  });
});

describe('request ledger — P8 the answers are observed only when the initialize answer was', () => {
  it('false until the `initialize` answer passes the observer; another id, or a notification, never counts', () => {
    const ledger = new RequestLedger({ server: 'tickets', strict: true });
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    expect(ledger.answersObserved).toBe(false);
    void watched.send(initialize);
    deliver(t.target, { jsonrpc: '2.0', id: 5, result: {} });
    deliver(t.target, { jsonrpc: '2.0', method: 'notifications/message', params: {} });
    expect(ledger.answersObserved).toBe(false);
    deliver(t.target, initialized);
    expect(ledger.answersObserved).toBe(true);
  });

  it("an SDK that REPLACES the transport's handler when it connects (SDK 1.10) leaves the answers unobserved", () => {
    const ledger = new RequestLedger({ server: 'tickets', strict: true });
    const t = transport();
    const watched = watchedBy(ledger, t.target);
    t.target.onmessage = (_message: unknown): void => undefined;
    void watched.send(initialize);
    deliver(t.target, initialized);
    expect(ledger.answersObserved).toBe(false);
  });

  it('the observer runs BEFORE the handler that was there, and never instead of it', () => {
    const seen: unknown[] = [];
    const ledger = new RequestLedger({ server: 'tickets', strict: true });
    const t = transport();
    t.target.onmessage = (message: unknown): void => {
      seen.push(message);
    };
    const watched = watchedBy(ledger, t.target);
    void watched.send(initialize);
    deliver(t.target, initialized);
    expect(ledger.answersObserved).toBe(true);
    expect(seen).toEqual([initialized]);
  });
});

describe('request ledger — P9 an awaited answer is released by its request id', () => {
  it('the HTTP send finishing alone keeps the watch: a 202 or a stream can still carry the answer', async () => {
    const { ledger, t, watched } = strictConnection();
    const issued = ledger.issue();
    const sending = watched.send(call(1, markParams({ name: 'search_tickets' }, issued.marker)));
    t.release();
    await sending;
    // The call, and its awaited answer.
    expect(ledger.retained).toBe(2);
    deliver(t.target, { jsonrpc: '2.0', id: 1, result: {} });
    expect(ledger.retained).toBe(1);
    ledger.settle(issued);
    expect(ledger.retained).toBe(0);
  });

  it("the SDK's cancellation ends the watch, by the id it names", async () => {
    const { ledger, t, watched } = strictConnection();
    const issued = ledger.issue();
    const sending = watched.send(call(1, markParams({ name: 'search_tickets' }, issued.marker)));
    t.release();
    await sending;
    void watched.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 1, reason: 'timed out' },
    });
    expect(ledger.retained, 'only the call itself, until it settles').toBe(1);
    ledger.settle(issued);
    expect(ledger.retained).toBe(0);
  });

  it('the call settling ends the watch, found by its marker: a COPY of its params cannot keep it alive', async () => {
    const { ledger, t, watched } = strictConnection();
    const calls = [ledger.issue(), ledger.issue(), ledger.issue()];
    const sends = calls.map((issued, i) =>
      watched.send(
        call(i + 1, structuredClone(markParams({ name: 'search_tickets' }, issued.marker))),
      ),
    );
    t.release();
    await Promise.all(sends);
    expect(ledger.retained).toBe(6);
    for (const issued of calls) ledger.settle(issued);
    expect(ledger.retained).toBe(0);
  });

  it('the connection closing ends everything it held', () => {
    const { ledger, watched } = strictConnection();
    const calls = [ledger.issue(), ledger.issue(), ledger.issue()];
    void watched.send(call(1, markParams({ name: 'search_tickets' }, calls[0]!.marker)));
    void watched.send(call(2, markParams({ name: 'search_tickets' }, calls[1]!.marker)));
    expect(ledger.retained).toBeGreaterThan(0);
    ledger.close();
    expect(ledger.retained).toBe(0);
  });
});

describe('request ledger — P9 a call ended by its connection closing is no mismatch', () => {
  it('dev mode names a request sent without its marker — never a matched call that settled after the close', () => {
    enableDevMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const marked of [true, false]) {
        warn.mockClear();
        const ledger = new RequestLedger();
        const watched = watchedBy(ledger, transport().target);
        const ctx = { [REQUEST_EVIDENCE]: { file: () => undefined } };
        const opened = openCall(
          { name: 'search_tickets', arguments: {} },
          ctx,
          undefined,
          ledger,
          'tickets',
        );
        // Marked: the SDK carried the call's `_meta`. Unmarked: it rebuilt the params.
        const params = marked ? opened.params : { name: 'search_tickets', arguments: {} };
        void watched.send(call(1, params));
        ledger.close();
        opened.close('failed');
        expect(warn.mock.calls.length, marked ? 'matched' : 'sent without its marker').toBe(
          marked ? 0 : 1,
        );
      }
    } finally {
      disableDevMode();
      warn.mockRestore();
    }
  });
});
