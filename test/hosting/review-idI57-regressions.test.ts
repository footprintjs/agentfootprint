/**
 * Review idI57 — the sign-in door and redirect findings, ported INVERTED:
 * every `FINDING` of the review's battery is a pin of the fix, and every
 * mutant that survived the builder's own tests (S-3) has a test that kills it.
 *
 *   B-2  the limiter's window runs from the LAST failure
 *   S-1  browser sign-in faults refuse the boot; run-time failures are logged
 *   S-2  no cookie bomb: kept returnTo ≤ 512 bytes, ≤ 3 pending attempts
 *   S-3  R4 dot segments · C2/C3 tx cleared on failure · C5 rotation · C6 the
 *        10-minute lifetime · C9 returnTo only from the seal · C10 duplicate
 *        tx cookies · R6 over-length · L9 the WS gated bound · L13 a success
 *        leaves the address alone
 *   N-1  RFC 9207 `iss` required when advertised; S256 checked at boot
 *   N-3  returnTo never names the door · N-4 a store failure at the callback
 *   N-5  a public URL with a path is refused · N-11 `ip:port` hops
 *   N-12 idle rows swept · N-13 frames coalesced behind one check
 */

import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  memorySignIns,
  nodeHost,
  safeReturnTo,
  signInDoor,
  signInSource,
  SIGN_IN_COOKIE,
  type DoorIdentity,
  type HostConversation,
  type SignInStore,
} from '../../src/hosting/index.js';
import type { HttpHostHandle } from '../../src/hosting/httpHost.js';
import { clientAddress, trustedProxies } from '../../src/hosting/signin/clientAddress.js';
import { addressBucket, attemptLimiter } from '../../src/hosting/signin/limits.js';
import { MAX_RETURN_TO_BYTES } from '../../src/hosting/signin/returnTo.js';
import {
  identityConfigFromEnv,
  identityFromConfig,
  MissingOpenIdClientError,
  OidcSignInSetupError,
  oidcIdentity,
  oidcSignIn,
} from '../../src/identity.js';
import {
  fakeBrowserIdp,
  type FakeBrowserIdp,
} from '../adapters/identity/conformance/fakeBrowserIdp.js';
import { fakeSignInStore, signInAs } from './fakeSignIns.js';
import {
  browserSignIn,
  Jar,
  mountRedirect,
  type MountedRedirect,
} from './signInRedirectHarness.js';
import { connectConversation } from './wsClient.js';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (open.length > 0) await open.pop()?.close();
});

async function mounted(extra: Parameters<typeof mountRedirect>[0] = {}): Promise<MountedRedirect> {
  const m = await mountRedirect(extra);
  open.push(m);
  return m;
}

/** Start a login, pass the IdP's form, and stop BEFORE the callback. */
async function upToCallback(m: MountedRedirect, user: string, jar = new Jar(), returnTo?: string) {
  const start = await fetch(
    `${m.url}/auth/login${
      returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`
    }`,
    { redirect: 'manual', headers: { cookie: jar.header() } },
  );
  jar.take(start);
  const authorizeUrl = start.headers.get('location') as string;
  const html = await (await fetch(authorizeUrl, { redirect: 'manual' })).text();
  const form = new URLSearchParams();
  for (const mm of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
    form.set(
      mm[1] as string,
      (mm[2] as string).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))),
    );
  }
  form.set('user', user);
  const posted = await fetch(new URL('/realm/login', authorizeUrl), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  return { jar, callback: new URL(posted.headers.get('location') as string) };
}

const clearsTx = (res: Response): boolean =>
  res.headers.getSetCookie().some((c) => /-tx-[A-Za-z0-9_-]{16}=;.*Max-Age=0/.test(c));

// ─── B-2 · L13 · N-11 · N-12 — the limiter, addresses, the store ─────

describe('review idI57 B-2 — the limiter window runs from the LAST failure', () => {
  it('a failure one second before the first window ends keeps the name refused a full window after IT', () => {
    const l = attemptLimiter({ perName: 2, windowMinutes: 1, backoffMs: 0 });
    const fail = (t: number) => {
      const v = l.begin('carol', '10.0.0.1', t);
      expect(v.kind).toBe('allow');
      if (v.kind === 'allow') l.failed(v.ticket, t);
    };
    fail(0);
    fail(59_000);
    const refused = l.begin('carol', '10.0.0.1', 60_000);
    expect(refused).toMatchObject({ kind: 'refuse', retryAfterSeconds: 59 });
    expect(l.begin('carol', '10.0.0.1', 118_999).kind).toBe('refuse');
    expect(l.begin('carol', '10.0.0.1', 119_000).kind).toBe('allow');
  });
});

describe('idI57 recheck — the name map cannot be flushed', () => {
  it('a victim at ONE failure keeps the counter after 10k junk names fill the map; new names are busy', () => {
    const l = attemptLimiter({ perName: 1, maxEntries: 100, backoffMs: 0 });
    const v = l.begin('victim', '10.0.0.1', 0);
    expect(v.kind).toBe('allow');
    if (v.kind === 'allow') l.failed(v.ticket, 0);
    const kinds = new Map<string, number>();
    for (let i = 0; i < 10_000; i += 1) {
      const junk = l.begin(`junk-${i}`, `10.1.${(i >> 8) & 255}.${i & 255}`, 1);
      kinds.set(junk.kind, (kinds.get(junk.kind) ?? 0) + 1);
      if (junk.kind === 'allow') l.failed(junk.ticket, 1);
    }
    expect(kinds.get('busy')).toBeGreaterThan(9_000);
    expect(l.begin('victim', '10.0.0.1', 2).kind).toBe('refuse');
  });

  it('a name counter at zero (its only attempt given back) is still evictable', () => {
    const l = attemptLimiter({ perName: 1, maxEntries: 2, backoffMs: 0 });
    const v = l.begin('gone', '10.0.0.1', 0);
    if (v.kind === 'allow') l.abandoned(v.ticket);
    const a = l.begin('a', '10.0.0.2', 1);
    if (a.kind === 'allow') l.failed(a.ticket, 1);
    expect(l.begin('b', '10.0.0.3', 2).kind).toBe('allow');
  });
});

describe('review idI57 L13 — a right password is not a strike against the address', () => {
  it('a morning of successful sign-ins through one proxy adds no delay', () => {
    const l = attemptLimiter({ perName: 5, perAddress: 2, backoffMs: 1_000 });
    for (let i = 0; i < 20; i += 1) {
      const v = l.begin(`person-${i}`, '10.0.0.1', 0);
      expect(v.kind).toBe('allow');
      if (v.kind === 'allow') {
        expect(v.delayMs).toBe(0);
        l.succeeded(v.ticket);
      }
    }
  });
});

describe('review idI57 N-11 — a forwarded hop with a port is one address', () => {
  const req = (peer: string, xff: string) =>
    ({ socket: { remoteAddress: peer }, headers: { 'x-forwarded-for': xff } } as never);
  it('ip:port and [v6]:port hops lose the port', () => {
    const t = trustedProxies(['10.0.0.0/8']);
    expect(clientAddress(req('10.0.0.5', '203.0.113.9:50001'), t)).toBe('203.0.113.9');
    expect(clientAddress(req('10.0.0.5', '203.0.113.9:50002'), t)).toBe('203.0.113.9');
    const v6a = clientAddress(req('10.0.0.5', '[2001:db8:1:2::9]:4431'), t);
    expect(addressBucket(v6a)).toBe(addressBucket('2001:db8:1:2::1'));
    expect(clientAddress(req('10.0.0.5', '2001:db8::1'), t)).toBe('2001:db8::1');
  });
});

describe('review idI57 N-12 — idle-dead sign-ins do not hold places', () => {
  it('with idleMinutes, a row idle past it is swept before the cap is counted', async () => {
    let now = 10_000_000;
    const s = memorySignIns({ max: 2, idleMinutes: 30, now: () => now, warn: () => undefined });
    const row = (key: string, userId: string) => ({
      key,
      identity: { userId },
      strategy: 'x',
      startedAt: now,
      lastSeenAt: now,
      expiresAt: now + 8 * 3_600_000,
    });
    await s.create(row('k1', 'u1'));
    await s.create(row('k2', 'u2'));
    now += 30 * 60_000;
    await s.create(row('k3', 'u3'));
    expect(s.size).toBe(1);
    expect(await s.find('k1')).toBeUndefined();
  });
});

// ─── S-2 · R6 · N-3 — returnTo and the cookie bomb ───────────────────

describe('review idI57 S-2 — no cookie bomb', () => {
  it('20 logins with a maximal returnTo: at most 3 pending cookies, the Cookie header stays under 8 KB, no 431', async () => {
    const m = await mounted();
    const jar = new Jar();
    const longest = `/${'a'.repeat(2040)}`;
    for (let i = 0; i < 20; i += 1) {
      const r = await fetch(`${m.url}/auth/login?returnTo=${encodeURIComponent(longest)}`, {
        redirect: 'manual',
        headers: { cookie: jar.header() },
      });
      jar.take(r);
      for (const set of r.headers.getSetCookie()) {
        expect((set.split(';')[0] as string).length).toBeLessThan(4096);
      }
    }
    expect([...jar.cookies.keys()].filter((k) => k.includes('-tx-')).length).toBeLessThanOrEqual(3);
    expect(jar.header().length).toBeLessThan(8 * 1024);
    const page = await fetch(`${m.url}/auth/me`, { headers: { cookie: jar.header() } });
    expect(page.status).not.toBe(431);
  });

  it('the NEWEST pending attempts are kept: a fourth login expires the oldest, and two logins in flight both finish', async () => {
    let t = Date.now();
    const m = await mounted({ door: { now: () => t } });
    const jar = new Jar();
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      t += 1_000;
      const r = await fetch(`${m.url}/auth/login`, {
        redirect: 'manual',
        headers: { cookie: jar.header() },
      });
      const issued = r.headers.getSetCookie().find((c) => !/Max-Age=0/.test(c)) as string;
      order.push(issued.split('=')[0] as string);
      jar.take(r);
    }
    const kept = [...jar.cookies.keys()].filter((k) => k.includes('-tx-')).sort();
    expect(kept).toEqual(order.slice(1).sort());
    // Two tabs: a login that started before a later one still finishes.
    const a = await upToCallback(m, 'alice', jar);
    t += 1_000;
    const b = await upToCallback(m, 'bob', jar);
    const ra = await fetch(a.callback, { redirect: 'manual', headers: { cookie: jar.header() } });
    expect(ra.headers.get('location')).toBe('/');
    const rb = await fetch(b.callback, { redirect: 'manual', headers: { cookie: jar.header() } });
    expect(rb.headers.get('location')).toBe('/');
  });

  it('900 × é (raw 901 characters) is kept as `/` — the kept form is measured AFTER encoding (R6)', async () => {
    const pub = new URL('https://app.example');
    expect(safeReturnTo(`/${'é'.repeat(900)}`, pub)).toBe('/');
    expect(safeReturnTo(`/${'a'.repeat(MAX_RETURN_TO_BYTES - 1)}`, pub)).toHaveLength(
      MAX_RETURN_TO_BYTES,
    );
    expect(safeReturnTo(`/${'a'.repeat(MAX_RETURN_TO_BYTES)}`, pub)).toBe('/');
    expect(safeReturnTo(`/${'a'.repeat(2049)}`, pub)).toBe('/');
    const m = await mounted();
    const r = await fetch(
      `${m.url}/auth/login?returnTo=${encodeURIComponent(`/${'é'.repeat(900)}`)}`,
      {
        redirect: 'manual',
      },
    );
    expect((r.headers.getSetCookie()[0] as string).split(';')[0]!.length).toBeLessThan(1400);
  });

  it('N-3: returnTo never names the door itself', () => {
    const pub = new URL('https://app.example');
    expect(safeReturnTo('/auth/login', pub, '/auth')).toBe('/');
    expect(safeReturnTo('/auth/callback?code=x&state=y', pub, '/auth')).toBe('/');
    expect(safeReturnTo('/AUTH/login', pub, '/auth')).toBe('/');
    expect(safeReturnTo('/x/../auth', pub, '/auth')).toBe('/');
    expect(safeReturnTo('/authors', pub, '/auth')).toBe('/authors');
  });

  it('N-3 end to end: a login asked to return to /auth/login lands on /', async () => {
    const m = await mounted();
    const flow = await browserSignIn(m, 'alice', { returnTo: '/auth/login' });
    expect(flow.location).toBe('/');
  });
});

// ─── S-3 — the callback's survivors ──────────────────────────────────

describe('review idI57 S-3 — the callback', () => {
  it('C2: a `state` failure clears the transaction cookie', async () => {
    const m = await mounted();
    const s = await upToCallback(m, 'alice');
    const forged = new URL(s.callback);
    forged.searchParams.set(
      'state',
      `${(forged.searchParams.get('state') ?? '').split('.')[0]}.forged`,
    );
    const r = await fetch(forged, { redirect: 'manual', headers: { cookie: s.jar.header() } });
    expect(r.headers.get('location')).toBe('/?signin_error=state');
    expect(clearsTx(r)).toBe(true);
  });

  it('C3: an exchange failure clears the transaction cookie', async () => {
    const m = await mounted();
    const s = await upToCallback(m, 'alice');
    const spent = new URL(s.callback);
    spent.searchParams.set('code', 'not-a-code-the-idp-issued');
    const r = await fetch(spent, { redirect: 'manual', headers: { cookie: s.jar.header() } });
    expect(r.headers.get('location')).toBe('/?signin_error=exchange-failed');
    expect(clearsTx(r)).toBe(true);
  });

  it('C5: a sign-in the browser already carries is ENDED at the callback (rotation)', async () => {
    const m = await mounted();
    const jar = new Jar();
    await browserSignIn(m, 'alice', { jar });
    const before = jar.header();
    expect(m.store.size).toBe(1);
    await browserSignIn(m, 'alice', { jar });
    expect(m.store.size).toBe(1);
    expect((await fetch(`${m.url}/auth/me`, { headers: { cookie: before } })).status).toBe(401);
  });

  it('C6: a transaction is good for 10 minutes and not a millisecond more', async () => {
    let t = Date.now();
    const m = await mounted({ door: { now: () => t } });
    const fresh = await upToCallback(m, 'alice');
    t += 600_000;
    const ok = await fetch(fresh.callback, {
      redirect: 'manual',
      headers: { cookie: fresh.jar.header() },
    });
    expect(ok.headers.get('location')).toBe('/');
    const stale = await upToCallback(m, 'bob');
    t += 600_001;
    const late = await fetch(stale.callback, {
      redirect: 'manual',
      headers: { cookie: stale.jar.header() },
    });
    expect(late.headers.get('location')).toBe('/?signin_error=state');
  });

  it('C9: returnTo comes only from the seal — a returnTo on the callback URL is ignored', async () => {
    const m = await mounted();
    const s = await upToCallback(m, 'alice', new Jar(), '/reports');
    const withQuery = new URL(s.callback);
    withQuery.searchParams.set('returnTo', '/somewhere-else');
    const r = await fetch(withQuery, { redirect: 'manual', headers: { cookie: s.jar.header() } });
    expect(r.headers.get('location')).toBe('/reports');
  });

  it('C10: two transaction cookies of one name name nothing', async () => {
    const m = await mounted();
    const s = await upToCallback(m, 'alice');
    const [[name, value]] = [...s.jar.cookies].filter(([k]) => k.includes('-tx-'));
    const r = await fetch(s.callback, {
      redirect: 'manual',
      headers: { cookie: `${name}=${value}; ${name}=${value}` },
    });
    expect(r.headers.get('location')).toBe('/?signin_error=state');
    expect(m.store.size).toBe(0);
  });

  it('N-4: a store that fails at the callback → the usual redirect, the tx cookie cleared, one log line', async () => {
    const lines: string[] = [];
    const broken: SignInStore = {
      create: async () => {
        throw new Error('store down');
      },
      find: async () => undefined,
      touch: async () => undefined,
      delete: async () => undefined,
    };
    const m = await mounted({ door: { store: broken, warn: (l) => lines.push(l) } });
    const s = await upToCallback(m, 'alice');
    const r = await fetch(s.callback, { redirect: 'manual', headers: { cookie: s.jar.header() } });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/?signin_error=unavailable');
    expect(clearsTx(r)).toBe(true);
    expect(lines.join('\n')).toMatch(/failed at the callback: Error/);
  });
});

// ─── N-1 — RFC 9207 and S256 ─────────────────────────────────────────

describe('review idI57 N-1 — what the IdP advertises is held to', () => {
  it('an IdP that advertises RFC 9207: a callback WITHOUT `iss` is refused; with it, signs in', async () => {
    const m = await mounted();
    m.idp.switches.discovery = { authorization_response_iss_parameter_supported: true };
    m.idp.switches.issOnCallback = true;
    const good = await browserSignIn(m, 'alice');
    expect(good.location).toBe('/');
    const m2 = await mounted();
    m2.idp.switches.discovery = { authorization_response_iss_parameter_supported: true };
    m2.idp.switches.issOnCallback = true;
    const stripped = await browserSignIn(m2, 'alice', {
      tamper: (u) => {
        u.searchParams.delete('iss');
        return u;
      },
    });
    expect(stripped.location).toMatch(/signin_error=/);
    expect(m2.store.size).toBe(0);
  });

  it('PKCE required and S256 not offered: ready() refuses (discovery)', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    idp.switches.discovery = { code_challenge_methods_supported: ['plain'] };
    const redirect = oidcSignIn({
      verifier: oidcIdentity({
        issuer: idp.issuer,
        audience: idp.audience,
        userIdClaim: 'oid',
        requiredScope: idp.scope,
        allowedClients: [idp.clientId],
        allowLoopbackHttp: true,
      }),
      clientId: idp.clientId,
      credential: { kind: 'secret', secret: idp.clientSecret },
      scope: `openid ${idp.scope}`,
      allowLoopbackHttp: true,
    });
    await expect(redirect.ready?.()).rejects.toMatchObject({ setting: 'discovery' });
    await expect(redirect.ready?.()).rejects.toBeInstanceOf(OidcSignInSetupError);
  });
});

// ─── S-1 — boot refusals and the run-time log ────────────────────────

describe('review idI57 S-1 — a browser sign-in that could never work refuses the boot', () => {
  async function env(idp: FakeBrowserIdp, extra: Record<string, string> = {}) {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'af-idp-'));
    writeFileSync(join(dir, 'secret'), idp.clientSecret);
    const ed = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    writeFileSync(join(dir, 'ed25519.pem'), ed);
    const base: Record<string, string> = {
      IDENTITY_STRATEGY: 'oidc-token',
      IDENTITY_ISSUER: idp.issuer,
      IDENTITY_AUDIENCE: idp.audience,
      IDENTITY_USER_ID_CLAIM: 'oid',
      IDENTITY_REQUIRED_SCOPE: idp.scope,
      IDENTITY_PUBLIC_URL: 'http://127.0.0.1:1',
      IDENTITY_CLIENT_ID: idp.clientId,
      IDENTITY_CLIENT_SECRET_FILE: join(dir, 'secret'),
      IDENTITY_SCOPE: `openid ${idp.scope}`,
    };
    const all = { ...base, ...extra };
    if (extra.IDENTITY_CLIENT_KEY_FILE === 'ed25519') {
      delete all.IDENTITY_CLIENT_SECRET_FILE;
      all.IDENTITY_CLIENT_KEY_FILE = join(dir, 'ed25519.pem');
    }
    return identityConfigFromEnv(all);
  }

  it('discovery with no authorization or token endpoint → IDENTITY_ISSUER', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    idp.switches.discovery = { authorization_endpoint: undefined, token_endpoint: undefined };
    await expect(identityFromConfig(await env(idp), { production: false })).rejects.toMatchObject({
      key: 'IDENTITY_ISSUER',
      message: expect.stringMatching(/authorization_endpoint/),
    });
  });

  it('openid-client missing → a refusal that says to install it', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    const missing = new Proxy(
      {},
      {
        get: () => {
          throw new MissingOpenIdClientError();
        },
      },
    );
    await expect(
      identityFromConfig(await env(idp), { production: false, openIdClient: missing as never }),
    ).rejects.toThrow(/npm install openid-client/);
  });

  it('a client key that is not RSA or EC P-256 → IDENTITY_CLIENT_KEY_FILE', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    await expect(
      identityFromConfig(await env(idp, { IDENTITY_CLIENT_KEY_FILE: 'ed25519' }), {
        production: false,
      }),
    ).rejects.toMatchObject({ key: 'IDENTITY_CLIENT_KEY_FILE' });
  });

  it('an IdP that is merely unreachable at boot is NOT a refusal; logins then fail, logged ONCE', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as never;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const choice = await identityFromConfig(await env(idp), { production: false, fetch: offline });
    expect(choice.mode).toBe('redirect');
    const { createServer } = await import('node:http');
    const server = createServer((q, r) => void choice.signInDoor?.handle(q, r));
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    open.push({ close: () => new Promise<void>((res) => server.close(() => res())) });
    const port = (server.address() as { port: number }).port;
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(`http://127.0.0.1:${port}/auth/login`, {
        redirect: 'manual',
        headers: { host: '127.0.0.1:1' },
      });
      expect(r.headers.get('location')).toBe('/?signin_error=unavailable');
    }
    const lines = warn.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => /browser sign-in failed/.test(l));
    expect(lines).toEqual([
      '[hosting] sign-in door: browser sign-in failed at the login: unavailable',
    ]);
  });
});

describe('review idI57 N-5 — the door runs at the origin root', () => {
  it('a public URL with a path is refused naming publicUrl', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    const verifier = oidcIdentity({
      issuer: idp.issuer,
      audience: idp.audience,
      userIdClaim: 'oid',
      requiredScope: idp.scope,
      allowedClients: [idp.clientId],
      allowLoopbackHttp: true,
    });
    const build = (publicUrl: string) => () =>
      signInDoor({
        redirect: oidcSignIn({
          verifier,
          clientId: idp.clientId,
          credential: { kind: 'secret', secret: idp.clientSecret },
          scope: 'openid',
        }),
        verify: verifier.verify,
        store: memorySignIns({ warn: () => undefined }),
        publicUrl,
        production: false,
      });
    expect(build('http://127.0.0.1:8080/neo/')).toThrow(
      expect.objectContaining({ option: 'publicUrl' }),
    );
    expect(build('http://127.0.0.1:8080/?x=1')).toThrow(
      expect.objectContaining({ option: 'publicUrl' }),
    );
    expect(build('http://127.0.0.1:8080/')).not.toThrow();
  });
});

// ─── L9 · N-13 — the WebSocket re-check ──────────────────────────────

async function wsHost(
  identity: DoorIdentity,
  limits?: { maxPendingBytes: number; maxFrameBytes: number },
) {
  const host = nodeHost({
    port: 0,
    hostname: '127.0.0.1',
    signIn: { identity },
    ...(limits && { conversationLimits: { idleMs: 60_000, ...limits } }),
  });
  const handle = (await host.serveConversations((c: HostConversation) => {
    c.onFrame((f) => c.send(`echo:${f}`));
  })) as HttpHostHandle;
  open.push(handle);
  return handle;
}

describe('review idI57 L9 / N-13 — the WebSocket re-check', () => {
  it('L9: frames waiting on a check that has NOT answered close the socket (1009) at the bound', async () => {
    const store = fakeSignInStore();
    const base = signInSource({ store, idleMinutes: 60 });
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let answered = false;
    let handshakeDone = false;
    const stuck = {
      identify: async (k: string) => {
        if (!handshakeDone) {
          handshakeDone = true;
          return base.identify(k);
        }
        await held; // the re-check never answers until the test says so
        answered = true;
        return base.identify(k);
      },
    };
    const h = await wsHost({ signIn: stuck }, { maxPendingBytes: 4_096, maxFrameBytes: 2_048 });
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(h.port, {
      headers: { cookie: `${SIGN_IN_COOKIE}=${alice.cookie}` },
    });
    expect((await client.opened).status).toBe(101);
    for (let i = 0; i < 4; i += 1) client.send('y'.repeat(2_000));
    expect((await client.closed).code).toBe(1009);
    expect(answered).toBe(false);
    release();
  });

  it('N-13: a burst of frames costs a couple of store lookups, not one per frame — and all arrive, in order', async () => {
    const store = fakeSignInStore();
    const base = signInSource({ store, idleMinutes: 60 });
    let lookups = 0;
    const slow = {
      identify: async (k: string) => {
        lookups += 1;
        await new Promise((r) => setTimeout(r, 40));
        return base.identify(k);
      },
    };
    const h = await wsHost({ signIn: slow });
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(h.port, {
      headers: { cookie: `${SIGN_IN_COOKIE}=${alice.cookie}` },
    });
    expect((await client.opened).status).toBe(101);
    const before = lookups;
    for (let i = 0; i < 20; i += 1) client.send(`f${i}`);
    const frames = await client.waitForFrames(20);
    expect(frames).toEqual(Array.from({ length: 20 }, (_, i) => `echo:f${i}`));
    expect(lookups - before).toBeLessThanOrEqual(3);
    client.destroy();
  });
});
