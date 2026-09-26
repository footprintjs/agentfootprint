/**
 * The credential seam (identity strategies, §9 step 3) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • THE ZERO-DELTA PIN — a host built WITHOUT `signIn`, and an `identity`
 *     without `signIn`/`tokenHeader`, behave byte for byte as before: the
 *     cookie header reaches the handler as sent, no `signInKey` key exists on
 *     the request, the 101 is written synchronously.
 *   • The transport strips the sign-in cookie and passes only its KEY
 *     (SHA-256) — a handler never sees the cookie (rule 10).
 *   • One credential per request: a token and a sign-in together are
 *     refused `'two-credentials'` (rule 13).
 *   • A sign-in that ended / expired / went idle / never existed is one
 *     answer, `'expired'`; a store that cannot answer is 503, never 401.
 *   • WebSocket: the sign-in is checked before the 101, re-checked before
 *     every inbound frame, and sign-out closes the socket (rule 21).
 */

import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  httpHost,
  IdentityNotVerifiedError,
  jsonWire,
  memorySessions,
  nodeHost,
  readSignIn,
  SIGN_IN_COOKIE,
  signInKeyOf,
  signInSource,
  standingAgent,
  verifyRequestIdentity,
  withoutCredentials,
  type HostConversation,
  type HostRequest,
  type IngressRecord,
} from '../../src/hosting/index.js';
import type { HttpHostHandle } from '../../src/hosting/httpHost.js';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { fakeSignInStore, signInAs } from './fakeSignIns.js';
import { connectConversation } from './wsClient.js';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

const cookieHeader = (value: string): string => `${SIGN_IN_COOKIE}=${value}`;

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'accepted';
  } catch (err) {
    return (err as { failure?: string }).failure ?? (err as { code?: string }).code ?? 'other';
  }
}

// ─── 1. UNIT — the cookie comes off, the key goes on ─────────────────

describe('readSignIn / withoutCredentials — unit', () => {
  it('strips ONLY the sign-in cookie and returns its SHA-256 key', () => {
    const read = readSignIn({
      Cookie: `sid=s-1; ${SIGN_IN_COOKIE}=abc123; theme=dark`,
      'X-Trace': 't',
    });
    expect(read.key).toBe(createHash('sha256').update('abc123').digest('base64url'));
    expect(read.headers).toEqual({ cookie: 'sid=s-1; theme=dark', 'x-trace': 't' });
  });

  it('drops the cookie header entirely when the sign-in was its only cookie', () => {
    expect(readSignIn({ cookie: `${SIGN_IN_COOKIE}=v` }).headers).toEqual({});
  });

  it('two cookies of the one name name nobody; an empty value names nobody', () => {
    const two = readSignIn({ cookie: `${SIGN_IN_COOKIE}=a; ${SIGN_IN_COOKIE}=b` });
    expect(two.key).toBeUndefined();
    expect(two.headers.cookie).toBeUndefined();
    expect(readSignIn({ cookie: `${SIGN_IN_COOKIE}=` }).key).toBeUndefined();
  });

  it('reads a quoted value as the value, and a custom cookie name', () => {
    expect(readSignIn({ cookie: `${SIGN_IN_COOKIE}="q"` }).key).toBe(signInKeyOf('q'));
    expect(readSignIn({ cookie: 'af-signin=v' }, 'af-signin').key).toBe(signInKeyOf('v'));
    expect(readSignIn({ cookie: 'af-signin=v' }).key).toBeUndefined();
  });

  it('withoutCredentials removes every credential-bearing header and keeps the rest', () => {
    expect(
      withoutCredentials({
        authorization: 'Bearer t',
        cookie: 'sid=1',
        'x-forwarded-access-token': 't2',
        'proxy-authorization': 'Basic x',
        'x-trace': 'keep',
      }),
    ).toEqual({ 'x-trace': 'keep' });
  });
});

describe('signInSource — unit', () => {
  it('a live sign-in identifies its person and restarts the idle clock', async () => {
    const store = fakeSignInStore();
    let t = 1_000_000;
    const source = signInSource({ store, idleMinutes: 30, now: () => t });
    const { key } = await signInAs(store, 'alice', { now: t });
    t += 29 * 60_000;
    expect((await source.identify(key))?.userId).toBe('alice');
    t += 29 * 60_000; // 58 min after start, 29 after the last request
    expect((await source.identify(key))?.userId).toBe('alice');
  });

  it('idle past the limit, or past the absolute lifetime, ends it — deleted and announced', async () => {
    const store = fakeSignInStore();
    let t = 0;
    const source = signInSource({ store, idleMinutes: 30, now: () => t });
    const ended: string[] = [];
    source.onEnd((key) => ended.push(key));
    const idle = await signInAs(store, 'alice', { now: t });
    t = 30 * 60_000;
    expect(await source.identify(idle.key)).toBeUndefined();
    expect(store.rows.has(idle.key)).toBe(false);

    const long = await signInAs(store, 'bob', { now: t, hours: 1 });
    for (let i = 0; i < 3; i += 1) {
      t += 20 * 60_000;
      await source.identify(long.key);
    }
    expect(await source.identify(long.key)).toBeUndefined(); // 60 min: absolute end
    expect(ended).toEqual([idle.key, long.key]);
  });

  it('end() deletes and tells every listener; a throwing listener is contained', async () => {
    const store = fakeSignInStore();
    const source = signInSource({ store, idleMinutes: 60 });
    const { key } = await signInAs(store, 'alice');
    const told: string[] = [];
    source.onEnd(() => {
      throw new Error('listener bug');
    });
    const off = source.onEnd((k) => told.push(k));
    await source.end(key);
    off();
    await source.end(key);
    expect(told).toEqual([key]);
    expect(await source.identify(key)).toBeUndefined();
  });

  it('refuses an idle limit that is not a positive number', () => {
    expect(() => signInSource({ store: fakeSignInStore(), idleMinutes: 0 })).toThrow(/idleMinutes/);
  });
});

// ─── 2. SCENARIO — verifyRequestIdentity with a sign-in source ───────

describe('verifyRequestIdentity with signIn — scenarios', () => {
  it('a live sign-in is the person; an ended one is `expired`; a guessed key is the same answer', async () => {
    const store = fakeSignInStore();
    const source = signInSource({ store, idleMinutes: 60 });
    const { key } = await signInAs(store, 'alice');
    const options = { signIn: source };
    expect((await verifyRequestIdentity(options, {}, undefined, key))?.userId).toBe('alice');
    await source.end(key);
    expect(await failureOf(() => verifyRequestIdentity(options, {}, undefined, key))).toBe(
      'expired',
    );
    expect(
      await failureOf(() => verifyRequestIdentity(options, {}, undefined, signInKeyOf('guess'))),
    ).toBe('expired');
  });

  it('ONE CREDENTIAL PER REQUEST: a bearer token beside a sign-in is `two-credentials`', async () => {
    const store = fakeSignInStore();
    const { key } = await signInAs(store, 'alice');
    const options = {
      verify: async () => ({ userId: 'alice' }),
      signIn: signInSource({ store, idleMinutes: 60 }),
    };
    expect(
      await failureOf(() =>
        verifyRequestIdentity(options, { authorization: 'Bearer t' }, undefined, key),
      ),
    ).toBe('two-credentials');
  });

  it('a sign-in store that cannot answer is 503, never a signed-out caller', async () => {
    const store = fakeSignInStore();
    const { key } = await signInAs(store, 'alice');
    store.down = true;
    expect(
      await failureOf(() =>
        verifyRequestIdentity(
          { signIn: signInSource({ store, idleMinutes: 60 }) },
          {},
          undefined,
          key,
        ),
      ),
    ).toBe('ERR_IDENTITY_VERIFIER_UNAVAILABLE');
  });

  it('a sign-in and a claimed other user is `claimed-another-user`', async () => {
    const store = fakeSignInStore();
    const { key } = await signInAs(store, 'alice');
    const options = { signIn: signInSource({ store, idleMinutes: 60 }) };
    expect(await failureOf(() => verifyRequestIdentity(options, {}, 'bob', key))).toBe(
      'claimed-another-user',
    );
  });

  it('a sign-in-only door: a bearer is `unverifiable`, nothing is `no-token`', async () => {
    const options = { signIn: signInSource({ store: fakeSignInStore(), idleMinutes: 60 }) };
    expect(
      await failureOf(() =>
        verifyRequestIdentity(options, { authorization: 'Bearer t' }, undefined),
      ),
    ).toBe('unverifiable');
    expect(await failureOf(() => verifyRequestIdentity(options, {}, undefined))).toBe('no-token');
  });

  it('tokenHeader reads a proxy header as the raw token (a Bearer prefix tolerated)', async () => {
    const seen: string[] = [];
    const options = {
      verify: async (t: string) => {
        seen.push(t);
        return { userId: 'alice' };
      },
      tokenHeader: 'x-forwarded-access-token',
    };
    await verifyRequestIdentity(options, { 'x-forwarded-access-token': 'raw.jwt' }, undefined);
    await verifyRequestIdentity(options, { 'x-forwarded-access-token': 'Bearer b.jwt' }, undefined);
    // The default header is NOT read when another is named.
    expect(
      await failureOf(() =>
        verifyRequestIdentity(options, { authorization: 'Bearer x' }, undefined),
      ),
    ).toBe('no-token');
    expect(seen).toEqual(['raw.jwt', 'b.jwt']);
  });
});

// ─── 3. INTEGRATION — the transport and the conversation door ────────

async function rawHost(signIn?: Parameters<typeof nodeHost>[0]['signIn']) {
  const seen: HostRequest[] = [];
  const conversations: HostConversation[] = [];
  const host = nodeHost({ port: 0, hostname: '127.0.0.1', ...(signIn && { signIn }) });
  const requests = (await host.serve((request, reply) => {
    seen.push(request);
    reply.complete('ok');
  })) as HttpHostHandle;
  open.push(requests);
  const convs = (await host.serveConversations((conversation) => {
    conversations.push(conversation);
    conversation.onFrame((frame) => conversation.send(`echo:${frame}`));
  })) as HttpHostHandle;
  open.push(convs);
  return { url: requests.url, port: requests.port, seen, conversations };
}

async function post(url: string, headers: Record<string, string>, body: object = { input: 'hi' }) {
  const res = await fetch(`${url}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('the transport — integration', () => {
  it('THE ZERO-DELTA PIN: without signIn the cookie reaches the handler as sent, and no signInKey key exists', async () => {
    const { url, seen } = await rawHost();
    await post(url, { cookie: `sid=1; ${SIGN_IN_COOKIE}=secret-value` });
    expect(seen[0]?.headers?.cookie).toBe(`sid=1; ${SIGN_IN_COOKIE}=secret-value`);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['headers', 'input', 'signal']);
  });

  it('with signIn the handler never sees the cookie, and gets its key', async () => {
    const store = fakeSignInStore();
    const identity = { signIn: signInSource({ store, idleMinutes: 60 }) };
    const { url, seen } = await rawHost({ identity });
    await post(url, { cookie: `sid=1; ${SIGN_IN_COOKIE}=secret-value` });
    expect(seen[0]?.headers?.cookie).toBe('sid=1');
    expect(JSON.stringify(seen[0]?.headers)).not.toContain('secret-value');
    expect(seen[0]?.signInKey).toBe(signInKeyOf('secret-value'));
  });

  it('standingAgent: a sign-in is served as its person; ended and two-credentials are refused and recorded', async () => {
    const store = fakeSignInStore();
    const source = signInSource({ store, idleMinutes: 60 });
    const identity = { signIn: source, verify: async () => ({ userId: 'bearer-user' }) };
    const records: IngressRecord[] = [];
    const handle = await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1', signIn: { identity } }),
      identity,
      onIngressDecision: (r) => records.push(r),
    });
    open.push(handle);
    const url = (handle as unknown as { url: string }).url;
    const alice = await signInAs(store, 'alice');
    const cookie = { cookie: cookieHeader(alice.cookie) };

    const served = await post(url, cookie, { input: 'hi', sessionId: 's-1' });
    expect(served.status).toBe(200);
    expect(records.at(-1)?.userId).toBe('alice');

    const both = await post(url, { ...cookie, authorization: 'Bearer t' }, { input: 'hi' });
    expect(both.status).toBe(401);
    expect(records.at(-1)?.identityFailure).toBe('two-credentials');

    await source.end(alice.key);
    const ended = await post(url, cookie, { input: 'hi', sessionId: 's-1' });
    expect(ended.status).toBe(401);
    expect(records.at(-1)?.identityFailure).toBe('expired');
    expect(JSON.stringify(records)).not.toContain(alice.cookie);
  });

  it('WEBSOCKET: no sign-in → 401 before the 101; a live one → 101 with the key on the port, no cookie', async () => {
    const store = fakeSignInStore();
    const identity = { signIn: signInSource({ store, idleMinutes: 60 }) };
    const { port, conversations } = await rawHost({ identity });

    const anonymous = connectConversation(port);
    expect((await anonymous.opened).status).toBe(401);

    const alice = await signInAs(store, 'alice');
    const client = connectConversation(port, {
      headers: { cookie: `sid=9; ${cookieHeader(alice.cookie)}` },
    });
    expect((await client.opened).status).toBe(101);
    client.send('one');
    expect(await client.waitForFrames(1)).toEqual(['echo:one']);
    expect(conversations[0]?.signInKey).toBe(alice.key);
    expect(conversations[0]?.headers?.cookie).toBe('sid=9');
    client.destroy();
  });

  it('WEBSOCKET: sign-out closes the open socket (1008), and a frame after it is never delivered', async () => {
    const store = fakeSignInStore();
    const source = signInSource({ store, idleMinutes: 60 });
    const { port } = await rawHost({ identity: { signIn: source } });
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(port, { headers: { cookie: cookieHeader(alice.cookie) } });
    expect((await client.opened).status).toBe(101);
    await source.end(alice.key);
    const closed = await client.closed;
    expect(closed.code).toBe(1008);
    expect(client.frames()).toEqual([]);
  });

  it('WEBSOCKET: a sign-in that ends with no onEnd (another process) is caught on the next frame', async () => {
    const store = fakeSignInStore();
    const base = signInSource({ store, idleMinutes: 60 });
    // A source without onEnd: the per-frame re-check is the only guard.
    const source = { identify: (key: string) => base.identify(key) };
    const { port } = await rawHost({ identity: { signIn: source } });
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(port, { headers: { cookie: cookieHeader(alice.cookie) } });
    expect((await client.opened).status).toBe(101);
    client.send('before');
    expect(await client.waitForFrames(1)).toEqual(['echo:before']);
    store.rows.delete(alice.key); // signed out elsewhere
    client.send('after');
    const closed = await client.closed;
    expect(closed.code).toBe(1008);
    expect(client.frames()).toEqual(['echo:before']);
  });

  it('WEBSOCKET: a store outage mid-conversation closes 1011, never as a sign-out', async () => {
    const store = fakeSignInStore();
    const { port } = await rawHost({
      identity: { signIn: signInSource({ store, idleMinutes: 60 }) },
    });
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(port, { headers: { cookie: cookieHeader(alice.cookie) } });
    expect((await client.opened).status).toBe(101);
    store.down = true;
    client.send('x');
    expect((await client.closed).code).toBe(1011);
  });

  it('WEBSOCKET: a bearer handshake is verified with the same funnel; two credentials refused', async () => {
    const store = fakeSignInStore();
    const identity = {
      signIn: signInSource({ store, idleMinutes: 60 }),
      verify: async (t: string) => {
        if (t !== 'good') throw new IdentityNotVerifiedError('unverifiable', false);
        return { userId: 'script' };
      },
    };
    const { port, conversations } = await rawHost({ identity });
    const bearer = connectConversation(port, { headers: { authorization: 'Bearer good' } });
    expect((await bearer.opened).status).toBe(101);
    expect(conversations[0]?.signInKey).toBeUndefined();
    bearer.destroy();
    const alice = await signInAs(store, 'alice');
    const both = connectConversation(port, {
      headers: { authorization: 'Bearer good', cookie: cookieHeader(alice.cookie) },
    });
    expect((await both.opened).status).toBe(401);
  });

  it('refuses a half-spelled signIn option by name at construction', () => {
    expect(() =>
      httpHost({
        name: 'h',
        wire: jsonWire,
        invokePath: '/i',
        healthPath: '/h',
        hostname: '127.0.0.1',
        signIn: {} as never,
      }),
    ).toThrow(/signIn needs 'identity'/);
    expect(() =>
      nodeHost({
        hostname: '127.0.0.1',
        signIn: { cookieName: 'bad name', identity: { verify: async () => ({ userId: 'x' }) } },
      }),
    ).toThrow(/not a cookie name/);
  });
});

// ─── 4. PROPERTY — the key is a function of the value, and never the value ─

describe('the sign-in key — properties', () => {
  it('for any cookie value the door mints (base64url): one key, 43 base64url chars, never containing the value', () => {
    let seed = 11;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const keys = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      let value = '';
      const len = 8 + Math.floor(next() * 40);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      for (let j = 0; j < len; j += 1) value += alphabet[Math.floor(next() * alphabet.length)];
      const key = signInKeyOf(value);
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(key).not.toContain(value);
      expect(readSignIn({ cookie: `a=b; ${SIGN_IN_COOKIE}=${value}` }).key).toBe(key);
      keys.add(key);
    }
    expect(keys.size).toBeGreaterThan(295);
  });
});

// ─── 5. SECURITY — the cookie never travels ──────────────────────────

describe('the credential seam — security', () => {
  it('a refusal, a record and the handler headers never carry the cookie value', async () => {
    const store = fakeSignInStore();
    const source = signInSource({ store, idleMinutes: 60 });
    const records: IngressRecord[] = [];
    const handle = await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1', signIn: { identity: { signIn: source } } }),
      identity: { signIn: source },
      onIngressDecision: (r) => records.push(r),
    });
    open.push(handle);
    const url = (handle as unknown as { url: string }).url;
    const value = 'ZZZ-cookie-value-that-must-not-travel';
    const refused = await post(url, { cookie: cookieHeader(value) });
    expect(refused.status).toBe(401);
    expect(JSON.stringify(refused.body)).not.toContain(value);
    expect(JSON.stringify(records)).not.toContain(value);
    expect(JSON.stringify(records)).not.toContain(signInKeyOf(value));
  });
});

// ─── 6. PERFORMANCE — one store read per request / frame ─────────────

describe('the credential seam — performance', () => {
  it('a request costs one find and one touch; a request with no cookie costs none', async () => {
    const store = fakeSignInStore();
    const source = signInSource({ store, idleMinutes: 60 });
    const alice = await signInAs(store, 'alice');
    await verifyRequestIdentity({ signIn: source }, {}, undefined, alice.key);
    expect(store.calls).toEqual({ find: 1, touch: 1, delete: 0 });
    await verifyRequestIdentity(
      { signIn: source, allowAnonymous: true },
      {},
      undefined,
      undefined,
    ).catch(() => undefined);
    expect(store.calls.find).toBe(1);
  });
});

// ─── 7. ROI — the same object at both doors ──────────────────────────

describe('the credential seam — ROI', () => {
  it('one identity object configures the request door and the conversation door', async () => {
    const store = fakeSignInStore();
    const identity = { signIn: signInSource({ store, idleMinutes: 30 }) };
    const { url, port } = await rawHost({ identity });
    const alice = await signInAs(store, 'alice');
    const cookie = cookieHeader(alice.cookie);
    expect((await post(url, { cookie })).status).toBe(200);
    const client = connectConversation(port, { headers: { cookie } });
    expect((await client.opened).status).toBe(101);
    client.destroy();
  });
});
