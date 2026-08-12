/**
 * browserSessionId + the session wire — the two halves of "which conversation
 * is this?" (9.10.0).
 *
 * The laws being pinned:
 *   • THE CLIENT HALF MINTS ONCE. A second call in the same page returns the
 *     same id, out of `localStorage` when there is one and out of memory when
 *     there is not — and a storage that THROWS is a fallback, never a crash.
 *   • TWO KEYS ARE TWO CONVERSATIONS.
 *   • THE SERVER HALF READS `x-session-id` BY DEFAULT, still prefers the body,
 *     and can be pointed at another header without a second wire.
 *   • COOKIE MODE ISSUES ONCE. A request with no session gets a `Set-Cookie`
 *     with `HttpOnly` and `SameSite=Lax`; a request that already carries a
 *     session — by cookie, header or body — is issued nothing, because two
 *     handles for one conversation is worse than none.
 *   • THE FRAMING IS NEVER THE DIALECT'S. A wire cannot set `content-type` on
 *     the reply.
 *
 * Test types (Convention 3): unit · boundary (no storage, throwing storage) ·
 * property (idempotent per key) · integration (over real HTTP) · security (the
 * cookie's flags, and that a session is never treated as identity) ·
 * regression (the default header keeps working unchanged) · ROI (one line in a
 * page).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { browserSessionId, DEFAULT_SESSION_STORAGE_KEY } from '../../src/index.js';
import { jsonWire, jsonWireWith, nodeHost } from '../../src/hosting/index.js';

// ─── A localStorage stand-in ─────────────────────────────────────────

function fakeStorage(): Storage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length(): number {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage & { readonly map: Map<string, string> };
}

/** Install a `localStorage` for the duration of one test. */
function withStorage(store: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  withStorage(undefined);
});

// ─── unit + property: the client half ────────────────────────────────

describe('browserSessionId', () => {
  it('mints once and hands the same id back', () => {
    withStorage(fakeStorage());
    const key = 'test.mint-once';
    const first = browserSessionId({ storageKey: key });
    const second = browserSessionId({ storageKey: key });
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(10);
  });

  it('persists under the storage key, so a reload keeps the conversation', () => {
    const store = fakeStorage();
    withStorage(store);
    const key = 'test.persist';
    const id = browserSessionId({ storageKey: key });
    expect(store.map.get(key)).toBe(id);

    // A "reload": the same storage, a page that has forgotten everything else.
    expect(browserSessionId({ storageKey: key })).toBe(id);
  });

  it('two storage keys are two conversations', () => {
    withStorage(fakeStorage());
    const support = browserSessionId({ storageKey: 'test.support' });
    const billing = browserSessionId({ storageKey: 'test.billing' });
    expect(support).not.toBe(billing);
  });

  it('names its default key, so a page can clear it deliberately', () => {
    const store = fakeStorage();
    withStorage(store);
    const id = browserSessionId();
    expect(store.map.get(DEFAULT_SESSION_STORAGE_KEY)).toBe(id);
  });

  it('BOUNDARY — with no localStorage at all it still works, in memory', () => {
    withStorage(undefined);
    const key = 'test.no-storage';
    const first = browserSessionId({ storageKey: key });
    const second = browserSessionId({ storageKey: key });
    expect(first).toBe(second);
  });

  it('BOUNDARY — a storage that THROWS on access is a fallback, never a crash', () => {
    const hostile = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;
    withStorage(hostile);
    const key = 'test.hostile';
    const first = browserSessionId({ storageKey: key });
    const second = browserSessionId({ storageKey: key });
    expect(first).toBe(second);
  });
});

// ─── unit: the server half reads what the client sends ───────────────

describe('the request wire — where a session id may be', () => {
  const facts = (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Parameters<typeof jsonWire.readRequest>[0] => ({
    body,
    headers,
    query: new URLSearchParams(),
  });

  it("REGRESSION — 'x-session-id' is still the default header", () => {
    expect(jsonWire.readRequest(facts({ input: 'hi' }, { 'x-session-id': 'from-header' }))).toEqual(
      {
        input: 'hi',
        sessionId: 'from-header',
      },
    );
  });

  it('the body still wins over the header', () => {
    const read = jsonWire.readRequest(
      facts({ input: 'hi', sessionId: 'from-body' }, { 'x-session-id': 'from-header' }),
    );
    expect(read.sessionId).toBe('from-body');
  });

  it('a different header can be named without writing a second wire', () => {
    const wire = jsonWireWith({ sessionHeader: 'X-Conversation' });
    const read = wire.readRequest(facts({ input: 'hi' }, { 'x-conversation': 'gateway-9' }));
    expect(read.sessionId).toBe('gateway-9');
    // …and the old one stops being magic, which is the point of naming it.
    expect(wire.readRequest(facts({ input: 'hi' }, { 'x-session-id': 'old' })).sessionId).toBe(
      undefined,
    );
  });

  it('no session anywhere means NO session — never an error, never an invention', () => {
    const read = jsonWire.readRequest(facts({ input: 'hi' }));
    expect(read.sessionId).toBeUndefined();
    expect(read.responseHeaders).toBeUndefined();
  });
});

// ─── security: cookie mode ───────────────────────────────────────────

describe('the request wire — cookie mode', () => {
  const wire = jsonWireWith({ sessionCookie: 'af_session' });
  const facts = (
    headers: Record<string, string> = {},
    body: Record<string, unknown> = { input: 'hi' },
  ): Parameters<typeof wire.readRequest>[0] => ({
    body,
    headers,
    query: new URLSearchParams(),
  });

  it('issues a session when the caller carried none — HttpOnly, SameSite=Lax, Path=/', () => {
    const read = wire.readRequest(facts());
    expect(read.sessionId).toBeDefined();
    const cookie = read.responseHeaders?.['set-cookie'] ?? '';
    expect(cookie).toContain(`af_session=${String(read.sessionId)}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('reads the cookie back, and issues NOTHING the second time', () => {
    const first = wire.readRequest(facts());
    const id = String(first.sessionId);
    const second = wire.readRequest(facts({ cookie: `other=1; af_session=${id}; more=2` }));
    expect(second.sessionId).toBe(id);
    expect(second.responseHeaders).toBeUndefined();
  });

  it('a caller that named its own session is never handed a competing one', () => {
    const byHeader = wire.readRequest(facts({ 'x-session-id': 'mine' }));
    expect(byHeader.sessionId).toBe('mine');
    expect(byHeader.responseHeaders).toBeUndefined();

    const byBody = wire.readRequest(facts({}, { input: 'hi', sessionId: 'also-mine' }));
    expect(byBody.sessionId).toBe('also-mine');
    expect(byBody.responseHeaders).toBeUndefined();
  });

  it('two fresh callers are two conversations', () => {
    const a = wire.readRequest(facts());
    const b = wire.readRequest(facts());
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('a handshake reads the cookie but never mints one — a 101 cannot carry it', () => {
    const read = wire.readConversation?.({
      headers: { cookie: 'af_session=ws-1' },
      query: new URLSearchParams(),
    });
    expect(read?.sessionId).toBe('ws-1');

    const empty = wire.readConversation?.({ headers: {}, query: new URLSearchParams() });
    expect(empty?.sessionId).toBeUndefined();
  });
});

// ─── integration: over real HTTP ─────────────────────────────────────

describe('nodeHost — the session options, end to end', () => {
  it('the default header reaches the handler, unchanged', async () => {
    const seen: Array<string | undefined> = [];
    const handle = await nodeHost({ port: 0 }).serve((request, reply) => {
      seen.push(request.sessionId);
      reply.complete('ok');
    });
    try {
      await fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Session-Id': 'CASED-header' },
        body: JSON.stringify({ input: 'hello' }),
      });
      expect(seen).toEqual(['CASED-header']);
    } finally {
      await handle.close();
    }
  });

  it('cookie mode issues one on the first call and reads it on the second', async () => {
    const seen: Array<string | undefined> = [];
    const handle = await nodeHost({ port: 0, sessionCookie: 'af_session' }).serve(
      (request, reply) => {
        seen.push(request.sessionId);
        reply.complete('ok');
      },
    );
    try {
      const first = await fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'hello' }),
      });
      const setCookie = first.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('af_session=');
      expect(setCookie).toContain('HttpOnly');
      // The reply is still JSON — a dialect does not get to choose the framing.
      expect(first.headers.get('content-type')).toContain('application/json');
      expect(await first.json()).toEqual({ output: 'ok' });

      const issued = setCookie.split(';')[0] ?? '';
      const second = await fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: issued },
        body: JSON.stringify({ input: 'again' }),
      });
      expect(second.headers.get('set-cookie')).toBeNull();
      expect(seen[0]).toBeDefined();
      expect(seen[1]).toBe(seen[0]);
    } finally {
      await handle.close();
    }
  });

  it('a custom header is what the deployment says it is', async () => {
    const seen: Array<string | undefined> = [];
    const handle = await nodeHost({ port: 0, sessionHeader: 'x-conversation' }).serve(
      (request, reply) => {
        seen.push(request.sessionId);
        reply.complete('ok');
      },
    );
    try {
      await fetch(`${handle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-conversation': 'c-77' },
        body: JSON.stringify({ input: 'hello' }),
      });
      expect(seen).toEqual(['c-77']);
    } finally {
      await handle.close();
    }
  });
});
