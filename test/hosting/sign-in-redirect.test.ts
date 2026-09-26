/**
 * Browser sign-in by redirect — the OIDC code flow (design §5, §9 step 5).
 * PENDING INDEPENDENT REVIEW. 7-pattern tests (unit · scenario · integration ·
 * property · security · performance · ROI), against the fake browser IdP over
 * real HTTP and the real `openid-client`.
 *
 * The laws being pinned:
 *   • The callback order of §5.2: the sealed transaction cookie opens and
 *     matches `state`; it is cleared WHATEVER happens; the code is exchanged
 *     with the client credential and the PKCE verifier; the ID token is
 *     checked; the person comes from the ACCESS token through the strategy's
 *     own verify; a 303 with `Referrer-Policy: no-referrer`.
 *   • Nothing is written on the server for a login GET; the transaction lives
 *     only in the sealed, per-attempt cookie.
 *   • `returnTo` never leaves the public origin (§5.5).
 *   • One id per person, browser or bearer.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { randomSealKey, safeReturnTo, signInKeyOf } from '../../src/hosting/index.js';
import { seal, unseal } from '../../src/hosting/signin/seal.js';
import { identityConfigFromEnv, identityFromConfig, oidcSignIn } from '../../src/identity.js';
import { fakeBrowserIdp } from '../adapters/identity/conformance/fakeBrowserIdp.js';
import {
  browserSignIn,
  Jar,
  mountRedirect,
  type MountedRedirect,
} from './signInRedirectHarness.js';
import { connectConversation } from './wsClient.js';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});
async function mounted(extra: Parameters<typeof mountRedirect>[0] = {}): Promise<MountedRedirect> {
  const m = await mountRedirect(extra);
  open.push(m);
  return m;
}
const me = (m: MountedRedirect, jar: Jar) =>
  fetch(`${m.url}/auth/me`, { headers: { cookie: jar.header() } });

// ─── 1. UNIT — returnTo, the seal ────────────────────────────────────

describe('safeReturnTo — unit (design §5.5, pinned)', () => {
  const base = new URL('https://neo.corp.example');
  it.each([
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/\t/evil.example', '/'],
    ['/%09/evil.example', '/%09/evil.example'],
    ['https://evil.example', '/'],
    ['https://neo.corp.example/x', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    [undefined, '/'],
    ['/reports?q=1#top', '/reports?q=1#top'],
    ['/a/../b', '/b'],
    // Dot segments that RESOLVE to a protocol-relative path: the final `//`
    // check is their only guard (review idI57 R4).
    ['/.//evil.example', '/'],
    ['/..//evil.example', '/'],
    ['/%2e%2e//evil.example', '/'],
    ['/%2e//evil.example', '/'],
    ['/a/..//evil.example', '/'],
  ])('%j → %j', (input, want) => {
    const got = safeReturnTo(input, base);
    expect(got).toBe(want);
    expect(new URL(got, base).origin).toBe(base.origin);
  });
});

describe('the seal — unit', () => {
  it('opens only with the same key AND the same cookie name, and refuses a tampered value', () => {
    const key = randomSealKey();
    const sealed = seal(key, 'tx-a', { s: 'state' });
    expect(unseal(key, 'tx-a', sealed)).toEqual({ s: 'state' });
    expect(unseal(key, 'tx-b', sealed)).toBeUndefined();
    expect(unseal(randomSealKey(), 'tx-a', sealed)).toBeUndefined();
    const bytes = Buffer.from(sealed, 'base64url');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    expect(unseal(key, 'tx-a', bytes.toString('base64url'))).toBeUndefined();
    expect(sealed).not.toContain('state');
  });
});

// ─── 2. SCENARIO — the flow ──────────────────────────────────────────

describe('redirect sign-in — scenarios', () => {
  it('signs a person in: the id is the ACCESS token oid; 303 to returnTo with no-referrer; the cookie attributes', async () => {
    const m = await mounted();
    expect(await (await fetch(`${m.url}/auth/config`)).json()).toEqual({ mode: 'redirect' });
    const flow = await browserSignIn(m, 'alice', { returnTo: '/reports?q=1' });
    expect(flow.status).toBe(303);
    expect(flow.location).toBe('/reports?q=1');
    expect(flow.referrerPolicy).toBe('no-referrer');
    expect(
      flow.setCookies.some((c) => /^af-signin-tx-[^=]+=; .*SameSite=Lax; Max-Age=0$/.test(c)),
    ).toBe(true);
    expect(
      flow.setCookies.some((c) =>
        /^af-signin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/.test(c),
      ),
    ).toBe(true);
    const who = (await (await me(m, flow.jar)).json()) as Record<string, unknown>;
    expect(who.displayName).toBe('Alice Archer');
    const key = signInKeyOf(flow.jar.cookies.get('af-signin') as string);
    expect((await m.store.find(key))?.identity.userId).toBe(m.idp.users.alice?.oid);
    expect(m.idp.lastClientAuth).toBe('secret');
  });

  it('the authorization request: code, S256 PKCE, state, nonce, the redirect URI and the scope', async () => {
    const m = await mounted();
    const flow = await browserSignIn(m, 'alice');
    const q = flow.authorize as URLSearchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('redirect_uri')).toBe(`${m.url}/auth/callback`);
    expect(q.get('scope')).toBe(`openid ${m.idp.scope}`);
    expect(q.get('nonce')?.length).toBeGreaterThan(20);
    expect(q.get('resource')).toBeNull();
  });

  it('a private-key client (private_key_jwt) signs in; a key the IdP never registered is refused', async () => {
    const m = await mounted({ privateKey: true, signIn: { resource: 'urn:neo:api' } });
    const flow = await browserSignIn(m, 'alice');
    expect(flow.status).toBe(303);
    expect(flow.location).toBe('/');
    expect(m.idp.lastClientAuth).toBe('private-key');
    // AD FS: the Web API identifier travels as `resource`.
    expect(flow.authorize?.get('resource')).toBe('urn:neo:api');
    const stranger = await fakeBrowserIdp();
    open.push(stranger);
    const wrongKey = await mounted({
      signIn: { credential: { kind: 'private-key', pem: stranger.clientKeyPem } },
    });
    expect((await browserSignIn(wrongKey, 'alice')).location).toBe(
      '/?signin_error=exchange-failed',
    );
  });

  it('PKCE off (AD FS 2016): no challenge is sent; the ID token and nonce still bind the login', async () => {
    const m = await mounted({ signIn: { pkce: 'off' } });
    m.idp.switches.requirePkce = false;
    const flow = await browserSignIn(m, 'bob');
    expect(flow.authorize?.get('code_challenge')).toBeNull();
    expect(flow.status).toBe(303);
    expect((await me(m, flow.jar)).status).toBe(200);
  });

  it.each([
    ['no ID token in the token response', { omitIdToken: true }, 'id-token-refused'],
    ['an ID token for another nonce', { wrongNonce: true }, 'id-token-refused'],
    [
      'an app-only ACCESS token (roles, no scope)',
      { accessTokenClaims: { scp: undefined, roles: ['x'] } },
      'not-a-person',
    ],
    [
      'an access token for another client',
      { accessTokenClaims: { azp: 'other-app' } },
      'not-a-person',
    ],
    ['an IdP error', { authorizeError: true }, 'idp-error'],
  ] as const)('refused: %s → %s, and no sign-in', async (_label, switches, reason) => {
    const m = await mounted();
    m.idp.switches = { ...switches };
    const flow = await browserSignIn(m, 'alice');
    expect(flow.status).toBe(303);
    expect(flow.location).toBe(`/?signin_error=${reason}`);
    expect(flow.jar.cookies.has('af-signin')).toBe(false);
    expect(m.store.size).toBe(0);
  });

  it('a state that does not match, or no transaction cookie at all, is refused as `state`', async () => {
    const m = await mounted();
    const wrongState = await browserSignIn(m, 'alice', {
      tamper: (u) => {
        u.searchParams.set('state', `${(u.searchParams.get('state') ?? '').split('.')[0]}.forged`);
        return u;
      },
    });
    expect(wrongState.location).toBe('/?signin_error=state');
    // LOGIN FORGERY: the attacker's own callback URL, completed in a victim's
    // browser, finds no transaction cookie there to open.
    const forged = await browserSignIn(m, 'alice', { otherBrowser: true });
    expect(forged.location).toBe('/?signin_error=state');
    expect(m.store.size).toBe(0);
    // A TRUE replay (review idI57 N-6): the captured callback URL with the
    // captured transaction cookie. Nothing is stored on the server, so the seal
    // still opens and `state` still matches — the IdP's single-use code is what
    // refuses it, and no second sign-in is made.
    const jar = new Jar();
    let replay: { url: URL; cookie: string } | undefined;
    const done = await browserSignIn(m, 'bob', {
      jar,
      tamper: (u) => {
        replay = { url: new URL(u), cookie: jar.header() };
        return u;
      },
    });
    expect(done.status).toBe(303);
    const captured = replay as { url: URL; cookie: string };
    const again = await fetch(captured.url, {
      redirect: 'manual',
      headers: { cookie: captured.cookie },
    });
    expect(again.headers.get('location')).toBe('/?signin_error=exchange-failed');
    expect(again.headers.getSetCookie().some((c) => /-tx-[^=]+=;.*Max-Age=0/.test(c))).toBe(true);
    expect(m.store.size).toBe(1);
  });

  it('sign-out: the local sign-in ends and the page is sent to the IdP end-session URL', async () => {
    const m = await mounted();
    const flow = await browserSignIn(m, 'alice');
    const out = await fetch(`${m.url}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: flow.jar.header() },
      body: '{}',
    });
    const next = new URL(((await out.json()) as { next: string }).next);
    expect(next.pathname).toBe('/realm/logout');
    expect(next.searchParams.get('client_id')).toBe(m.idp.clientId);
    expect(next.searchParams.get('post_logout_redirect_uri')).toBe(`${m.url}/`);
    expect((await me(m, flow.jar)).status).toBe(401);
  });
});

// ─── 3. INTEGRATION — one id, sockets, the door ──────────────────────

describe('redirect sign-in — integration', () => {
  it('ONE PATH: the browser sign-in and a bearer token give the same id at /invoke', async () => {
    const m = await mounted();
    const flow = await browserSignIn(m, 'alice');
    const viaCookie = await fetch(`${m.url}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: flow.jar.header() },
      body: JSON.stringify({ input: 'hi', sessionId: 's-1' }),
    });
    expect(viaCookie.status).toBe(200);
    const cookieId = m.records.at(-1)?.userId;
    const viaBearer = await fetch(`${m.url}/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await m.idp.accessTokenFor('alice')}`,
      },
      body: JSON.stringify({ input: 'hi', sessionId: 's-2' }),
    });
    expect(viaBearer.status).toBe(200);
    expect(m.records.at(-1)?.userId).toBe(cookieId);
    expect(cookieId).toBe(m.idp.users.alice?.oid);
  });

  it('sign-out closes an open socket carrying the sign-in', async () => {
    const m = await mounted();
    const flow = await browserSignIn(m, 'bob');
    const client = connectConversation(m.port, { headers: { cookie: flow.jar.header() } });
    expect((await client.opened).status).toBe(101);
    await fetch(`${m.url}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: flow.jar.header() },
      body: '{}',
    });
    expect((await client.closed).code).toBe(1008);
  });

  it('the transaction cookie never reaches a handler', async () => {
    const m = await mounted();
    const jar = new Jar();
    const start = await fetch(`${m.url}/auth/login`, { redirect: 'manual' });
    jar.take(start);
    const tx = [...jar.cookies.keys()].find((k) => k.startsWith('af-signin-tx-')) as string;
    expect(tx).toBeDefined();
    const res = await fetch(`${m.url}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${jar.header()}; sid=1` },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect(res.status).toBe(401); // no sign-in, and the tx cookie is not one
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────

describe('redirect sign-in — properties', () => {
  it('no returnTo, however built, leaves the public origin', () => {
    const base = new URL('https://neo.corp.example');
    const parts = [
      '/',
      '//',
      '\\',
      '\t',
      '\n',
      '%2f',
      'evil.example',
      '@',
      ':',
      '..',
      '.',
      '%2e',
      '%2e%2e',
      '?',
      '#',
      'http:',
      ' ',
    ];
    let seed = 3;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 4000; i += 1) {
      // Half the inputs start with one `/` — the shape that passes the raw
      // checks and reaches the resolver, where dot segments live.
      let input = next() < 0.5 ? '/' : '';
      const n = 1 + Math.floor(next() * 6);
      for (let j = 0; j < n; j += 1) input += parts[Math.floor(next() * parts.length)];
      const kept = safeReturnTo(input, base);
      expect(new URL(kept, base).origin, JSON.stringify(input)).toBe(base.origin);
      expect(kept.startsWith('/') && !kept.startsWith('//')).toBe(true);
    }
  });

  it('every attempt gets its own transaction cookie and state', async () => {
    const m = await mounted();
    const names = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const start = await fetch(`${m.url}/auth/login`, { redirect: 'manual' });
      const set = start.headers.getSetCookie()[0] as string;
      names.add(set.split('=')[0] as string);
      expect(set).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600$/);
    }
    expect(names.size).toBe(5);
  });
});

// ─── 5. SECURITY ─────────────────────────────────────────────────────

describe('redirect sign-in — security', () => {
  it("the IdP's own words never reach the page, and the code does not leak onward", async () => {
    const m = await mounted();
    m.idp.switches.authorizeError = true;
    const flow = await browserSignIn(m, 'alice');
    expect(flow.location).toBe('/?signin_error=idp-error');
    expect(flow.referrerPolicy).toBe('no-referrer');
  });

  it('a transaction cookie from one attempt does not open another attempt', async () => {
    const m = await mounted();
    const a = await fetch(`${m.url}/auth/login`, { redirect: 'manual' });
    const aCookie = (a.headers.getSetCookie()[0] as string).split(';')[0] as string;
    const b = await fetch(`${m.url}/auth/login`, { redirect: 'manual' });
    const bState = new URL(b.headers.get('location') as string).searchParams.get('state') as string;
    const [aName, aValue] = aCookie.split('=') as [string, string];
    const bName = `af-signin-tx-${bState.split('.')[0]}`;
    const moved = await fetch(`${m.url}/auth/callback?code=x&state=${bState}`, {
      redirect: 'manual',
      headers: { cookie: `${bName}=${aValue}` },
    });
    expect(aName).not.toBe(bName);
    expect(moved.headers.get('location')).toBe('/?signin_error=state');
  });

  it('boot refuses the audience equal to the client id (an ID token would pass as an access token)', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    await expect(
      identityFromConfig(
        identityConfigFromEnv({
          IDENTITY_STRATEGY: 'oidc-token',
          IDENTITY_ISSUER: idp.issuer,
          IDENTITY_AUDIENCE: idp.clientId,
          IDENTITY_USER_ID_CLAIM: 'oid',
          IDENTITY_REQUIRED_SCOPE: idp.scope,
          IDENTITY_PUBLIC_URL: 'http://127.0.0.1:1',
          IDENTITY_CLIENT_ID: idp.clientId,
          IDENTITY_CLIENT_SECRET_FILE: '/dev/null',
          IDENTITY_SCOPE: 'openid x',
        }),
        { production: false },
      ),
    ).rejects.toMatchObject({ key: 'IDENTITY_AUDIENCE' });
  });

  it('refuses at construction: no openid scope, no credential, a bad PKCE value', () => {
    const verifier = {
      discover: async () => ({ kind: 'outage' }),
      verify: async () => ({ userId: 'x' }),
    } as never;
    const base = { verifier, clientId: 'c', credential: { kind: 'secret', secret: 's' } } as const;
    expect(() => oidcSignIn({ ...base, scope: 'api' })).toThrow(/openid/);
    expect(() => oidcSignIn({ ...base, scope: 'openid', credential: undefined as never })).toThrow(
      /credential/,
    );
    expect(() => oidcSignIn({ ...base, scope: 'openid', pkce: 'maybe' as never })).toThrow(/pkce/);
  });
});

// ─── 6. PERFORMANCE — nothing on the server for a login GET ──────────

describe('redirect sign-in — performance', () => {
  it('50 login GETs write nothing on the server', async () => {
    const m = await mounted();
    for (let i = 0; i < 50; i += 1) await fetch(`${m.url}/auth/login`, { redirect: 'manual' });
    expect(m.store.size).toBe(0);
  });
});

// ─── 7. ROI — from config ────────────────────────────────────────────

describe('redirect sign-in — ROI', () => {
  it('identityFromConfig turns on browser sign-in when its keys are set; half set is refused', async () => {
    const idp = await fakeBrowserIdp();
    open.push(idp);
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'af-idp-'));
    writeFileSync(join(dir, 'secret'), `${idp.clientSecret}\n`);
    const env = {
      IDENTITY_STRATEGY: 'oidc-token',
      IDENTITY_ISSUER: idp.issuer,
      IDENTITY_AUDIENCE: idp.audience,
      IDENTITY_USER_ID_CLAIM: 'oid',
      IDENTITY_REQUIRED_SCOPE: idp.scope,
      IDENTITY_PUBLIC_URL: 'http://127.0.0.1:5350',
      IDENTITY_CLIENT_ID: idp.clientId,
      IDENTITY_CLIENT_SECRET_FILE: join(dir, 'secret'),
      IDENTITY_SCOPE: `openid ${idp.scope}`,
    };
    const choice = await identityFromConfig(identityConfigFromEnv(env), { production: false });
    expect(choice.mode).toBe('redirect');
    expect(choice.signInDoor?.cookieName).toBe('af-signin');
    expect(typeof choice.identity?.verify).toBe('function');
    expect(choice.banner.join('\n')).toMatch(/PENDING INDEPENDENT REVIEW/);
    expect(choice.banner.join('\n')).toMatch(/no IDENTITY_COOKIE_KEY_FILE/);
    expect(choice.banner.join('\n')).not.toContain(idp.clientSecret);
    const { IDENTITY_CLIENT_ID: _drop, ...half } = env;
    await expect(
      identityFromConfig(identityConfigFromEnv(half), { production: false }),
    ).rejects.toMatchObject({ key: 'IDENTITY_CLIENT_ID' });
  });
});
