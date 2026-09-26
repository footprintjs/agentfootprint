/**
 * The sign-in door (identity strategies, §9 step 4) — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • POST /auth/login: the door guard runs unconditionally (Host, Origin,
 *     JSON only); a bad body gets a FIXED sentence (never the parser's, which
 *     quotes the input); every wrong credential gets ONE answer after a
 *     minimum time; attempt limits grow a delay before refusing; a sign-in
 *     already present is ENDED first.
 *   • The cookie (§5.4): `__Host-Http-af-signin`, HttpOnly, Secure,
 *     SameSite=Strict, Path=/, no Domain; plain-http localhost is `af-signin`
 *     without Secure, development only.
 *   • Sign-ins last 8 h and end after the idle limit; the store is bounded.
 *   • Every /auth answer is no-store, unframeable, and carries no CORS header.
 *   • The password and the cookie value never reach a reply, a record or the store.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accountKeyOf,
  memorySignIns,
  signInDoor,
  signInKeyOf,
  WRONG_CREDENTIAL_SENTENCE,
} from '../../src/hosting/index.js';
import { addressBucket, attemptLimiter } from '../../src/hosting/signin/limits.js';
import { SignInStoreFullError } from '../../src/hosting/signin/errors.js';
import {
  hashPassword,
  identityConfigFromEnv,
  identityFromConfig,
  localPasswords,
} from '../../src/identity.js';
import {
  call,
  login,
  mountDoor,
  TEST_COST,
  testUsers,
  type MountedDoor,
} from './signInDoorHarness.js';
import { connectConversation } from './wsClient.js';

const open: MountedDoor[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});
async function mounted(extra: Parameters<typeof mountDoor>[0] = {}): Promise<MountedDoor> {
  const m = await mountDoor(extra);
  open.push(m);
  return m;
}

// ─── 1. UNIT — the store, the limiter, the password list, the cookie ──

describe('memorySignIns — unit', () => {
  const row = (key: string, userId = key, at = 0, hours = 1) => ({
    key,
    identity: { userId },
    strategy: 't',
    startedAt: at,
    expiresAt: at + hours * 3_600_000,
    lastSeenAt: at,
  });

  it('FULL: refuses a new sign-in rather than ending another account’s (review idI34 S-1)', async () => {
    const store = memorySignIns({ max: 3, warn: () => undefined, now: () => 0 });
    for (const k of ['a', 'b', 'c']) await store.create(row(k));
    await expect(store.create(row('d'))).rejects.toBeInstanceOf(SignInStoreFullError);
    expect((await store.find('a'))?.key).toBe('a');
    expect(store.size).toBe(3);
  });

  it('sweeps EXPIRED rows first, so dead sign-ins never crowd out live ones', async () => {
    let t = 0;
    const store = memorySignIns({ max: 2, warn: () => undefined, now: () => t });
    await store.create(row('old', 'old', 0, 1));
    await store.create(row('live', 'live', 0, 8));
    t = 2 * 3_600_000; // 'old' has expired
    await store.create(row('new', 'new', t));
    expect(await store.find('old')).toBeUndefined();
    expect((await store.find('live'))?.key).toBe('live');
  });

  it('a per-account cap: a person’s 11th sign-in ends THAT person’s oldest, announced through onDelete', async () => {
    const store = memorySignIns({ warn: () => undefined, now: () => 0 });
    const ended: string[] = [];
    store.onDelete((key) => ended.push(key));
    await store.create(row('bob-1', 'bob'));
    for (let i = 0; i < 11; i += 1) await store.create(row(`alice-${i}`, 'alice'));
    expect(ended).toEqual(['alice-0']);
    expect((await store.find('bob-1'))?.key).toBe('bob-1');
    expect(store.perAccount).toBe(10);
  });

  it('warns once past 90 % of the cap; refuses a bad cap by option name', async () => {
    const warnings: string[] = [];
    const store = memorySignIns({ max: 10, warn: (m) => warnings.push(m), now: () => 0 });
    for (let i = 0; i < 10; i += 1) await store.create(row(`k${i}`));
    expect(warnings).toHaveLength(1);
    expect(() => memorySignIns({ max: 0 })).toThrow(/max is a positive whole number/);
    expect(() => memorySignIns({ perAccount: 1.5 })).toThrow(/perAccount/);
  });

  it('hands out copies: a caller editing a found row edits nothing stored', async () => {
    const store = memorySignIns({ now: () => 0 });
    await store.create(row('a'));
    const found = (await store.find('a')) as { lastSeenAt: number };
    found.lastSeenAt = 999;
    expect((await store.find('a'))?.lastSeenAt).toBe(0);
  });
});

describe('attemptLimiter — unit', () => {
  it('COUNTS AN ATTEMPT AS IT STARTS: 50 parallel begins for one name → one allowed, the rest refused (review idI34 B-1)', () => {
    const limiter = attemptLimiter({ perName: 5, backoffMs: 0 });
    const verdicts = Array.from({ length: 50 }, () => limiter.begin('alice', '10.0.0.1', 0));
    expect(verdicts.filter((v) => v.kind === 'allow')).toHaveLength(1); // one check in flight per name
    expect(verdicts.filter((v) => v.kind === 'refuse')).toHaveLength(49);
  });

  it('the delay grows from the COUNTED attempts, then the name is refused until the window passes', () => {
    const limiter = attemptLimiter({ perName: 4, windowMinutes: 1, backoffMs: 100 });
    const delays: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const v = limiter.begin('alice', 'ip', 0);
      if (v.kind !== 'allow') throw new Error('expected allow');
      delays.push(v.delayMs);
      limiter.failed(v.ticket, 0);
    }
    expect(delays).toEqual([0, 0, 100, 200]);
    expect(limiter.begin('alice', 'ip', 1000)).toMatchObject({
      kind: 'refuse',
      retryAfterSeconds: 59,
    });
    expect(limiter.begin('alice', 'ip', 60_000).kind).toBe('allow');
  });

  it('a success clears the name; an abandoned check (directory down) is not counted', () => {
    const limiter = attemptLimiter({ perName: 2, backoffMs: 0 });
    const first = limiter.begin('alice', 'ip', 0);
    if (first.kind !== 'allow') throw new Error('allow');
    limiter.failed(first.ticket, 0);
    const second = limiter.begin('alice', 'ip', 0);
    if (second.kind !== 'allow') throw new Error('allow');
    limiter.abandoned(second.ticket);
    const third = limiter.begin('alice', 'ip', 0);
    if (third.kind !== 'allow') throw new Error('allow');
    limiter.succeeded(third.ticket);
    expect(limiter.begin('alice', 'ip', 0)).toMatchObject({ kind: 'allow', delayMs: 0 });
  });

  it('the ADDRESS budget only delays, never refuses — a shared proxy address cannot lock everybody out', () => {
    const limiter = attemptLimiter({ perName: 100, perAddress: 3, backoffMs: 100 });
    let last = 0;
    for (let i = 0; i < 20; i += 1) {
      const v = limiter.begin(`n${i}`, 'proxy', 0);
      expect(v.kind).toBe('allow');
      if (v.kind === 'allow') {
        last = v.delayMs;
        limiter.failed(v.ticket, 0);
      }
    }
    expect(last).toBe(800); // the capped delay
  });

  it('IPv6 is counted per /64: rotating addresses inside one network share a delay', () => {
    expect(addressBucket('2001:db8:1:2::a')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('2001:db8:1:2:ffff::1')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('10.0.0.1')).toBe('10.0.0.1');
    const limiter = attemptLimiter({ perName: 100, perAddress: 3, backoffMs: 100 });
    let delay = 0;
    for (let i = 0; i < 10; i += 1) {
      const v = limiter.begin(`n${i}`, `2001:db8:1:2::${i.toString(16)}`, 0);
      if (v.kind === 'allow') {
        delay = v.delayMs;
        limiter.failed(v.ticket, 0);
      }
    }
    expect(delay).toBeGreaterThan(0);
  });

  it('name counters cannot be FLUSHED by address churn: separate maps, penalising counters never evicted', () => {
    const limiter = attemptLimiter({ perName: 5, backoffMs: 0, maxEntries: 100 });
    for (let i = 0; i < 5; i += 1) {
      const v = limiter.begin('alice', '10.0.0.1', 0);
      if (v.kind === 'allow') limiter.failed(v.ticket, 0);
    }
    for (let i = 0; i < 5_000; i += 1) {
      const v = limiter.begin(`junk-${i}`, `2001:db8:${i.toString(16)}::1`, 1);
      if (v.kind === 'allow') limiter.failed(v.ticket, 1);
    }
    expect(limiter.begin('alice', '10.0.0.9', 2).kind).toBe('refuse');
    expect(limiter.size).toBeLessThanOrEqual(200);
  });

  it('bounded: when every counter still penalises, a NEW name is `busy`, never a forgotten penalty', () => {
    const limiter = attemptLimiter({ perName: 5, backoffMs: 0, maxEntries: 3 });
    for (const n of ['a', 'b', 'c']) {
      for (let i = 0; i < 2; i += 1) {
        const v = limiter.begin(n, '10.0.0.1', 0);
        if (v.kind === 'allow') limiter.failed(v.ticket, 0);
      }
    }
    expect(limiter.begin('d', '10.0.0.1', 0).kind).toBe('busy');
  });
});

describe('localPasswords / hashPassword — unit', () => {
  it('hashes with scrypt (the cost travels in the hash) and checks the right password only', async () => {
    const hash = await hashPassword('s3cret', TEST_COST);
    expect(hash).toMatch(/^scrypt\$14\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    const list = localPasswords({ priya: hash });
    expect(await list.check('priya', 's3cret')).toEqual({
      identity: { userId: 'priya' },
      displayName: 'priya',
    });
    expect(await list.check('priya', 'wrong')).toBeUndefined();
    expect(await list.check('Priya', 's3cret')).toBeUndefined(); // exact names
    expect(await list.check('nobody', 's3cret')).toBeUndefined();
  });

  it('refuses a plain password, a weak or malformed hash, a duplicate, an odd name, an empty list', async () => {
    const hash = await hashPassword('x', TEST_COST);
    expect(() => localPasswords('alice:hunter2')).toThrow(/not a scrypt hash/);
    expect(() => localPasswords(`alice:${hash.replace('$14$', '$10$')}`)).toThrow(
      /below the floor/,
    );
    expect(() => localPasswords('alice:scrypt$14$8$1$abc')).toThrow(/malformed/);
    expect(() => localPasswords(`alice:${hash},alice:${hash}`)).toThrow(/twice/);
    expect(() => localPasswords({ 'a,b': hash })).toThrow(/no ':', ','/);
    expect(() => localPasswords('')).toThrow(/empty/);
    expect(() => localPasswords('alice:hunter2')).not.toThrow(/hunter2/);
  });
});

describe('signInDoor construction — unit', () => {
  const base = async () => ({
    passwords: localPasswords(await testUsers()),
    store: memorySignIns(),
    production: false,
  });

  it('https: the __Host-Http- cookie; plain-http localhost: af-signin without Secure, said in the banner', async () => {
    const secure = signInDoor({
      ...(await base()),
      publicUrl: 'https://neo.corp.example',
      guard: { allowedHosts: ['neo.corp.example'] },
    });
    expect(secure.cookieName).toBe('__Host-Http-af-signin');
    const local = signInDoor({ ...(await base()), publicUrl: 'http://localhost:5350' });
    expect(local.cookieName).toBe('af-signin');
    expect(local.banner.join('\n')).toMatch(/WARNING .* plain http on this machine/);
    expect(local.banner.join('\n')).toMatch(/per process/);
  });

  it('refuses: plain http off loopback, plain http in production, no allowedHosts off loopback, "any", a public URL its own lists refuse', async () => {
    const b = await base();
    expect(() => signInDoor({ ...b, publicUrl: 'http://neo.corp.example' })).toThrow(
      /must be https/,
    );
    expect(() => signInDoor({ ...b, production: true, publicUrl: 'http://localhost:1' })).toThrow(
      /production/,
    );
    expect(() => signInDoor({ ...b, publicUrl: 'https://neo.corp.example' })).toThrow(
      /allowedHosts/,
    );
    expect(() =>
      signInDoor({ ...b, publicUrl: 'https://neo.corp.example', guard: { allowedHosts: 'any' } }),
    ).toThrow(/'any'/);
    expect(() =>
      signInDoor({
        ...b,
        publicUrl: 'https://neo.corp.example',
        guard: { allowedHosts: ['other.corp.example'] },
      }),
    ).toThrow(/refused by the door's own lists/);
  });
});

describe('the https cookie — unit (review idI34 S-8, M18)', () => {
  it('on an https public URL the sign-in cookie is __Host-Http-, Secure, HttpOnly, SameSite=Strict, Path=/, no Domain', async () => {
    const { createServer } = await import('node:http');
    const { request } = await import('node:http');
    const door = signInDoor({
      passwords: localPasswords(await testUsers()),
      store: memorySignIns(),
      publicUrl: 'https://neo.corp.example',
      production: true,
      guard: { allowedHosts: ['neo.corp.example'] },
      minimumResponseMs: 0,
    });
    const server = createServer((req, res) => void door.handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const setCookie = await new Promise<string>((resolve, reject) => {
        const body = JSON.stringify({ username: 'alice', password: 'alice-pw' });
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/auth/login',
            method: 'POST',
            headers: {
              host: 'neo.corp.example',
              origin: 'https://neo.corp.example',
              'content-type': 'application/json',
              'content-length': String(body.length),
            },
          },
          (res) => {
            res.resume();
            resolve(String(res.headers['set-cookie']?.[0] ?? `status ${res.statusCode}`));
          },
        );
        req.on('error', reject);
        req.end(body);
      });
      expect(setCookie).toMatch(
        /^__Host-Http-af-signin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/,
      );
      expect(setCookie).not.toMatch(/Domain/i);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ─── 2. SCENARIO — the routes ────────────────────────────────────────

describe('the sign-in door — scenarios', () => {
  it('config, login, me, a turn as the person, logout — and the cookie attributes', async () => {
    const m = await mounted();
    expect((await call(m.url, '/auth/config')).body).toEqual({ mode: 'password' });
    expect((await call(m.url, '/auth/me')).status).toBe(401);

    const signedIn = await login(m.url, 'alice', 'alice-pw');
    expect(signedIn.status).toBe(200);
    expect(signedIn.setCookie).toMatch(
      /^af-signin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/,
    );
    expect(signedIn.body).toMatchObject({
      displayName: 'alice',
      accountKey: accountKeyOf('alice'),
    });
    const cookie = signedIn.cookie as string;

    const me = await call(m.url, '/auth/me', { headers: { cookie } });
    expect(me.body).toMatchObject({ displayName: 'alice', accountKey: accountKeyOf('alice') });

    const turn = await call(m.url, '/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ input: 'hi', sessionId: 's-1' }),
    });
    expect(turn.status).toBe(200);
    expect(m.records.at(-1)?.userId).toBe('alice');

    const out = await call(m.url, '/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}',
    });
    expect(out.body).toEqual({ next: '/' });
    expect(out.headers.get('set-cookie')).toMatch(/^af-signin=; .*Max-Age=0$/);
    expect((await call(m.url, '/auth/me', { headers: { cookie } })).status).toBe(401);
  });

  it('ONE ANSWER for every wrong credential — unknown name, wrong password — after the minimum time', async () => {
    const m = await mounted({ minimumResponseMs: 120 });
    const started = Date.now();
    const unknown = await login(m.url, 'mallory', 'alice-pw');
    const wrong = await login(m.url, 'alice', 'not-it');
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body).toEqual({ error: WRONG_CREDENTIAL_SENTENCE });
  });

  it('a bad body gets a FIXED sentence that never quotes it; an empty password is refused before any check', async () => {
    const m = await mounted();
    const res = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"username":"alice","password":"hunter2-leak"',
    });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('hunter2');
    expect(res.body.error).toMatch(/must be a JSON object/);
    const empty = await login(m.url, 'alice', '');
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/both required/);
  });

  it('attempt limits: a name past its budget is refused with Retry-After — even with the right password', async () => {
    const m = await mounted({ limits: { perName: 3, backoffMs: 0 } });
    for (let i = 0; i < 3; i += 1) expect((await login(m.url, 'alice', 'nope')).status).toBe(401);
    const locked = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'alice-pw' }),
    });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await login(m.url, 'bob', 'bob-pw')).status).toBe(200); // another name is untouched
  });

  it('a sign-in already present is ENDED at login (login forgery cannot keep two)', async () => {
    const m = await mounted();
    const alice = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
    const bob = await login(m.url, 'bob', 'bob-pw', { cookie: alice });
    expect(bob.status).toBe(200);
    expect((await call(m.url, '/auth/me', { headers: { cookie: alice } })).status).toBe(401);
    // …and a FAILED login with a cookie present ends it too, and expires the cookie.
    const bobCookie = bob.cookie as string;
    const failed = await login(m.url, 'bob', 'wrong', { cookie: bobCookie });
    expect(failed.setCookie).toMatch(/Max-Age=0/);
    expect((await call(m.url, '/auth/me', { headers: { cookie: bobCookie } })).status).toBe(401);
  });

  it('unknown route 404, wrong method 405 with Allow, and a path outside /auth is not the door’s', async () => {
    const m = await mounted();
    expect((await call(m.url, '/auth/nope')).status).toBe(404);
    const wrong = await call(m.url, '/auth/login');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await call(m.url, '/elsewhere')).status).toBe(404);
  });

  it('lifetimes: 8 h absolute and the idle limit, on the door clock', async () => {
    let t = Date.now();
    const m = await mounted({ now: () => t, hours: 1, idleMinutes: 30 });
    const cookie = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
    t += 29 * 60_000;
    expect((await call(m.url, '/auth/me', { headers: { cookie } })).status).toBe(200);
    t += 31 * 60_000; // 60 min after the start: the absolute end
    expect((await call(m.url, '/auth/me', { headers: { cookie } })).status).toBe(401);
    const idle = (await login(m.url, 'bob', 'bob-pw')).cookie as string;
    t += 30 * 60_000;
    expect((await call(m.url, '/auth/me', { headers: { cookie: idle } })).status).toBe(401);
  });
});

// ─── 3. INTEGRATION — the door guard, sockets, trusted proxies ───────

describe('the sign-in door — integration', () => {
  it('THE GUARD RUNS ON LOGIN UNCONDITIONALLY: a form post is 415, a cross-site Origin 403, a foreign Host 421', async () => {
    const m = await mounted();
    const form = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"username":"alice","password":"alice-pw"}',
    });
    expect(form.status).toBe(415);
    const crossSite = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ username: 'alice', password: 'alice-pw' }),
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get('set-cookie')).toBeNull();
    const logout = await call(m.url, '/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    expect(logout.status).toBe(403);
  });

  it('sign-out closes an open socket carrying the sign-in (1008)', async () => {
    const m = await mounted();
    const cookie = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
    const client = connectConversation(m.port, { headers: { cookie } });
    expect((await client.opened).status).toBe(101);
    client.send('hi');
    expect(await client.waitForFrames(1)).toEqual(['echo:hi']);
    await call(m.url, '/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}',
    });
    expect((await client.closed).code).toBe(1008);
  });

  it('a request with no sign-in is refused at every door in a sign-in mode', async () => {
    const m = await mounted();
    const turn = await call(m.url, '/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect(turn.status).toBe(401);
    expect((await connectConversation(m.port).opened).status).toBe(401);
  });

  it('trusted proxies (a CIDR range): the address follows X-Forwarded-For only behind a listed proxy', async () => {
    const warnings: string[] = [];
    const m = await mounted({
      limits: { perName: 100, perAddress: 2, backoffMs: 60 },
      trustedProxies: ['127.0.0.0/8'],
      warn: (w) => warnings.push(w),
    });
    // Rightmost untrusted hop: 10.9.9.9 each time — one client, a growing delay.
    // Past its budget the address waits the capped 8 × backoffMs = 480 ms. The
    // bounds sit halfway, well clear of a loaded CI runner's own login latency
    // (~60 ms seen), so they measure the limiter, not the machine.
    const timed = async (name: string, xff: string) => {
      const t = Date.now();
      await login(m.url, name, 'p', { 'x-forwarded-for': xff });
      return Date.now() - t;
    };
    await timed('x1', '1.1.1.1, 10.9.9.9');
    await timed('x2', '2.2.2.2, 10.9.9.9');
    await timed('x3', '3.3.3.3, 10.9.9.9');
    expect(await timed('x4', '4.4.4.4, 10.9.9.9')).toBeGreaterThanOrEqual(450);
    // Another client behind the same proxy is not slowed by the first.
    expect(await timed('x5', '10.8.8.8')).toBeLessThan(240);
    expect(warnings).toEqual([]);
  });

  it('refuses a trustedProxies entry that is not an IP or a CIDR range', async () => {
    await expect(mounted({ trustedProxies: ['proxy.corp'] })).rejects.toThrow(
      /not an IP address or a CIDR range/,
    );
  });

  it('warns ONCE when X-Forwarded-For arrives and no proxy is trusted (one shared address budget)', async () => {
    const warnings: string[] = [];
    const m = await mounted({ warn: (w) => warnings.push(w) });
    await login(m.url, 'a', 'p', { 'x-forwarded-for': '1.1.1.1' });
    await login(m.url, 'b', 'p', { 'x-forwarded-for': '2.2.2.2' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/trustedProxies is not set/);
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────

describe('the sign-in door — properties', () => {
  it('accountKey: 128 bits, one per person, never the id itself', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const id = `user-${i}`;
      const key = accountKeyOf(id);
      expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(key).not.toContain(id);
      keys.add(key);
    }
    expect(keys.size).toBe(2000);
  });

  it('every login mints a fresh cookie; the store holds only its key', async () => {
    const m = await mounted();
    const values = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const cookie = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
      const value = cookie.split('=')[1] as string;
      values.add(value);
      expect(await m.store.find(value)).toBeUndefined();
      expect((await m.store.find(signInKeyOf(value)))?.identity.userId).toBe('alice');
    }
    expect(values.size).toBe(5);
  });
});

// ─── 5. SECURITY ─────────────────────────────────────────────────────

describe('the sign-in door — security', () => {
  it('no /auth answer carries a CORS header, and every one is no-store and unframeable', async () => {
    const m = await mounted();
    const answers = [
      await call(m.url, '/auth/config', { headers: { origin: `http://127.0.0.1:${m.port}` } }),
      await call(m.url, '/auth/me'),
      await (async () => call(m.url, '/auth/nope'))(),
      await call(m.url, '/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'alice-pw' }),
      }),
    ];
    for (const a of answers) {
      expect(a.headers.get('access-control-allow-origin')).toBeNull();
      expect(a.headers.get('access-control-allow-credentials')).toBeNull();
      expect(a.headers.get('cache-control')).toBe('no-store');
      expect(a.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    }
  });

  it('the password never reaches a reply, the ingress record or the store', async () => {
    const m = await mounted();
    const secret = 'hunter2-never-echoed';
    const replies = [
      (await login(m.url, 'alice', secret)).body,
      (await login(m.url, secret, secret)).body,
    ];
    await login(m.url, 'alice', 'alice-pw');
    expect(JSON.stringify(replies)).not.toContain(secret);
    expect(JSON.stringify(m.records)).not.toContain(secret);
  });
});

// ─── 6. PERFORMANCE ──────────────────────────────────────────────────

describe('the sign-in door — performance', () => {
  it('one store read and one touch per signed-in request', async () => {
    const m = await mounted();
    const cookie = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
    const before = m.store.size;
    for (let i = 0; i < 20; i += 1) {
      await call(m.url, '/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ input: 'hi', sessionId: 's-1' }),
      });
    }
    expect(m.store.size).toBe(before);
  });
});

// ─── 7. ROI — one config, the whole door ─────────────────────────────

describe('local-password from config — ROI', () => {
  it('identityFromConfig builds the door, the host option and the identity in one call; production refuses it', async () => {
    const env = {
      IDENTITY_STRATEGY: 'local-password',
      IDENTITY_PUBLIC_URL: 'http://localhost:5350',
      IDENTITY_LOCAL_USERS: await testUsers(),
    };
    const choice = await identityFromConfig(identityConfigFromEnv(env), { production: false });
    expect(choice.strategy).toBe('local-password');
    expect(choice.mode).toBe('password');
    expect(choice.signInDoor?.cookieName).toBe('af-signin');
    expect(choice.hostSignIn?.identity).toBe(choice.identity);
    expect(choice.banner.join('\n')).toMatch(/DEVELOPMENT ONLY/);
    await expect(
      identityFromConfig(identityConfigFromEnv(env), { production: true }),
    ).rejects.toMatchObject({ key: 'IDENTITY_STRATEGY' });
  });

  it('refuses a plain password in the list, a missing public URL, and oidc keys beside it', async () => {
    const boot = { production: false };
    await expect(
      identityFromConfig(
        identityConfigFromEnv({
          IDENTITY_STRATEGY: 'local-password',
          IDENTITY_PUBLIC_URL: 'http://localhost:5350',
          IDENTITY_LOCAL_USERS: 'alice:hunter2',
        }),
        boot,
      ),
    ).rejects.toMatchObject({ key: 'IDENTITY_LOCAL_USERS' });
    await expect(
      identityFromConfig(
        identityConfigFromEnv({
          IDENTITY_STRATEGY: 'local-password',
          IDENTITY_LOCAL_USERS: await testUsers(),
        }),
        boot,
      ),
    ).rejects.toMatchObject({ key: 'IDENTITY_PUBLIC_URL' });
    await expect(
      identityFromConfig(
        identityConfigFromEnv({
          IDENTITY_STRATEGY: 'local-password',
          IDENTITY_PUBLIC_URL: 'http://localhost:5350',
          IDENTITY_LOCAL_USERS: await testUsers(),
          IDENTITY_ISSUER: 'https://idp.example.test',
        }),
        boot,
      ),
    ).rejects.toMatchObject({ key: 'IDENTITY_ISSUER' });
  });
});
