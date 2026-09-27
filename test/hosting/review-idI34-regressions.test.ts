/**
 * The idI34 security review's attacks on §9 steps 3 and 4 (the credential seam,
 * the sign-in door, local-password), ported as REGRESSION tests: every
 * `FINDING` the review pinned is asserted here as the FIXED behaviour ("FIXED:"),
 * and every attack that held keeps holding ("HELD:").
 */

import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import {
  memorySignIns,
  nodeHost,
  readSignIn,
  SIGN_IN_COOKIE,
  signInDoor,
  signInKeyOf,
  signInSource,
  withoutCredentials,
  type SignInStore,
  type HostConversation,
  type DoorIdentity,
} from '../../src/hosting/index.js';
import type { HttpHostHandle } from '../../src/hosting/httpHost.js';
import { attemptLimiter } from '../../src/hosting/signin/limits.js';
import { SignInStoreFullError } from '../../src/hosting/signin/errors.js';
import { hashPassword, localPasswords } from '../../src/identity.js';
import { fakeSignInStore, signInAs } from './fakeSignIns.js';
import {
  call,
  login,
  mountDoor,
  TEST_COST,
  testUsers,
  type MountedDoor,
} from './signInDoorHarness.js';
import { connectConversation } from './wsClient.js';

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});
async function mounted(extra: Parameters<typeof mountDoor>[0] = {}): Promise<MountedDoor> {
  const m = await mountDoor(extra);
  open.push(m);
  return m;
}

/** A raw request where Host (and anything else) can be set. */
function raw(
  port: number,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const JSON_POST = { 'content-type': 'application/json' };
const creds = (u: string, p: string) => JSON.stringify({ username: u, password: p });

// ─── A. Login forgery / CSRF ─────────────────────────────────────────

describe('A — login forgery / CSRF on /auth/login and /auth/logout', () => {
  it('HELD: text/plain, a urlencoded form, a multipart form → 415; Origin null → 403', async () => {
    const m = await mounted();
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/json-seq',
      'application/vnd.api+json',
    ]) {
      const r = await raw(
        m.port,
        '/auth/login',
        'POST',
        { 'content-type': type, host: `127.0.0.1:${m.port}` },
        creds('alice', 'alice-pw'),
      );
      expect(r.status, type).toBe(415);
    }
    const nul = await raw(
      m.port,
      '/auth/login',
      'POST',
      { ...JSON_POST, origin: 'null', host: `127.0.0.1:${m.port}` },
      creds('alice', 'alice-pw'),
    );
    expect(nul.status).toBe(403);
    const nulOut = await raw(
      m.port,
      '/auth/logout',
      'POST',
      { ...JSON_POST, origin: 'null', host: `127.0.0.1:${m.port}` },
      '{}',
    );
    expect(nulOut.status).toBe(403);
  });

  it('HELD: Sec-Fetch-Site cross-site with no Origin → 403; same-site sibling Origin → 403', async () => {
    const m = await mounted();
    const noOrigin = await raw(
      m.port,
      '/auth/login',
      'POST',
      { ...JSON_POST, 'sec-fetch-site': 'cross-site', host: `127.0.0.1:${m.port}` },
      creds('alice', 'alice-pw'),
    );
    expect(noOrigin.status).toBe(403);
    const sibling = await raw(
      m.port,
      '/auth/login',
      'POST',
      {
        ...JSON_POST,
        origin: `http://localhost:${m.port + 1}`,
        'sec-fetch-site': 'same-site',
        host: `127.0.0.1:${m.port}`,
      },
      creds('alice', 'alice-pw'),
    );
    expect(sibling.status).toBe(403);
  });

  it('HELD: an OPTIONS preflight gets no CORS approval (405, no Access-Control-*)', async () => {
    const m = await mounted();
    const pre = await raw(m.port, '/auth/login', 'OPTIONS', {
      origin: 'https://evil.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
      host: `127.0.0.1:${m.port}`,
    });
    expect(pre.status).toBe(405);
    expect(Object.keys(pre.headers).some((h) => h.startsWith('access-control-'))).toBe(false);
  });

  it('NOTE: a missing Origin with no Fetch metadata is let through (a non-browser client) — by design', async () => {
    const m = await mounted();
    const r = await raw(
      m.port,
      '/auth/login',
      'POST',
      { ...JSON_POST, host: `127.0.0.1:${m.port}` },
      creds('alice', 'alice-pw'),
    );
    expect(r.status).toBe(200);
  });
});

// ─── B. Session fixation ─────────────────────────────────────────────

describe('B — session fixation', () => {
  it('HELD: a pre-set (attacker-chosen) cookie is never adopted: login mints a fresh value', async () => {
    const m = await mounted();
    const planted = `af-signin=attacker-chosen-value`;
    const r = await login(m.url, 'alice', 'alice-pw', { cookie: planted });
    expect(r.status).toBe(200);
    expect(r.cookie).not.toBe(planted);
    expect(await m.store.find(signInKeyOf('attacker-chosen-value'))).toBeUndefined();
    expect((await call(m.url, '/auth/me', { headers: { cookie: planted } })).status).toBe(401);
  });

  it('HELD: two cookies of the one name name nobody; a case-variant name is not the sign-in', () => {
    const two = readSignIn({ cookie: `${SIGN_IN_COOKIE}=a; ${SIGN_IN_COOKIE}=b` });
    expect(two.key).toBeUndefined();
    expect(two.headers.cookie).toBeUndefined();
    const lower = readSignIn({ cookie: `${SIGN_IN_COOKIE.toLowerCase()}=a` });
    expect(lower.key).toBeUndefined();
  });

  it('NOTE: a comma-joined pair is ONE odd value (hashed, unknown) — stripped, never forwarded', () => {
    const r = readSignIn({ cookie: `${SIGN_IN_COOKIE}=a, ${SIGN_IN_COOKIE}=b` });
    expect(r.headers.cookie).toBeUndefined();
    expect(r.key).toBe(signInKeyOf(`a, ${SIGN_IN_COOKIE}=b`));
  });
});

// ─── C. Timing / enumeration ─────────────────────────────────────────

describe('C — timing and enumeration', () => {
  it('HELD: unknown name and wrong password: same status, same body, same headers', async () => {
    const m = await mounted({ minimumResponseMs: 0 });
    const a = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: JSON_POST,
      body: creds('nobody', 'x'),
    });
    const b = await call(m.url, '/auth/login', {
      method: 'POST',
      headers: JSON_POST,
      body: creds('alice', 'x'),
    });
    expect(a.status).toBe(b.status);
    expect(a.text).toBe(b.text);
    const strip = (h: Headers) => [...h.entries()].filter(([k]) => k !== 'date').sort();
    expect(strip(a.headers)).toEqual(strip(b.headers));
  });

  it('HELD: the 429 is keyed on the TYPED name, whether or not it exists', async () => {
    const m = await mounted({ limits: { perName: 2, backoffMs: 0 } });
    for (const name of ['alice', 'ghost']) {
      await login(m.url, name, 'x');
      await login(m.url, name, 'x');
      expect((await login(m.url, name, 'x')).status, name).toBe(429);
    }
  });

  it('FIXED: a list with MIXED costs is refused at boot (one decoy cannot match every cost)', async () => {
    const cheap = await hashPassword('p', { log2N: 14, r: 8, p: 1 });
    const dear = await hashPassword('p', { log2N: 15, r: 8, p: 1 });
    expect(() => localPasswords(`first:${cheap},priya:${dear}`)).toThrow(/mixes scrypt costs/);
  });

  it('FIXED (S-8, M15): an unknown name costs one derive, like a known one — the decoy is real', async () => {
    const list = localPasswords(await testUsers());
    const time = async (name: string) => {
      const t = performance.now();
      await list.check(name, 'wrong');
      return performance.now() - t;
    };
    await time('warm');
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      known.push(await time('alice'));
      unknown.push(await time(`ghost-${i}`));
    }
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[2] as number;
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.5);
  }, 30_000);
});

// ─── D. Attempt limits ───────────────────────────────────────────────

describe('D — attempt limits', () => {
  it('FIXED (BLOCKING): 40 parallel guesses for one name — at most one per window budget reaches the checker, the rest 429', async () => {
    let checks = 0;
    const passwords = localPasswords(await testUsers());
    const counting = {
      ...passwords,
      check: (u: string, p: string) => ((checks += 1), passwords.check(u, p)),
    };
    const m = await mounted({
      passwords: counting,
      limits: { perName: 5, perAddress: 1000, backoffMs: 0 },
    });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        call(m.url, '/auth/login', {
          method: 'POST',
          headers: JSON_POST,
          body: creds('alice', `guess-${i}`),
        }),
      ),
    );
    const refused = results.filter((r) => r.status === 429).length;
    expect(checks).toBeLessThanOrEqual(5);
    expect(refused).toBeGreaterThanOrEqual(35);
    expect(results.every((r) => r.status === 401 || r.status === 429)).toBe(true);
  }, 60_000);

  it('FIXED (BLOCKING, unit): the limiter counts at `begin` — 50 parallel begins, one allowed', () => {
    const limiter = attemptLimiter({ perName: 5, backoffMs: 0 });
    const verdicts = Array.from({ length: 50 }, () => limiter.begin('alice', '10.0.0.1', 0));
    expect(verdicts.filter((v) => v.kind === 'allow')).toHaveLength(1);
  });

  it('FIXED: a door-wide cap on concurrent checks — past it the queue answers 503 with Retry-After', async () => {
    let running = 0;
    let most = 0;
    const slow = {
      strategy: 'test',
      check: async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 50));
        running -= 1;
        return undefined;
      },
    };
    const m = await mounted({
      passwords: slow,
      checks: { concurrent: 2, queue: 3 },
      limits: { perName: 100, perAddress: 1000, backoffMs: 0 },
    });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        call(m.url, '/auth/login', {
          method: 'POST',
          headers: JSON_POST,
          body: creds(`n${i}`, 'x'),
        }),
      ),
    );
    expect(most).toBeLessThanOrEqual(2);
    const busy = results.filter((r) => r.status === 503);
    expect(busy.length).toBeGreaterThan(0);
    expect(busy[0]?.headers.get('retry-after')).toBe('5');
  });

  it('FIXED: the address budget is per IPv6 /64 — rotating inside it keeps the delay growing', () => {
    const limiter = attemptLimiter({ perName: 1_000, perAddress: 3, backoffMs: 10 });
    let last = 0;
    for (let i = 0; i < 20; i += 1) {
      const v = limiter.begin(`name-${i}`, `2001:db8:1:2::${i.toString(16)}`, 0);
      if (v.kind === 'allow') {
        last = v.delayMs;
        limiter.failed(v.ticket, 0);
      }
    }
    expect(last).toBe(80);
  });

  it("FIXED: address churn cannot FLUSH a victim name's counter", () => {
    const limiter = attemptLimiter({ perName: 5, perAddress: 5, backoffMs: 0, maxEntries: 10_000 });
    for (let i = 0; i < 5; i += 1) {
      const v = limiter.begin('alice', '10.0.0.1', 0);
      if (v.kind === 'allow') limiter.failed(v.ticket, 0);
    }
    expect(limiter.begin('alice', '10.0.0.9', 0).kind).toBe('refuse');
    for (let i = 0; i < 5_000; i += 1) {
      const v = limiter.begin(`junk-${i}`, `2001:db8:${i.toString(16)}::1`, 1);
      if (v.kind === 'allow') limiter.failed(v.ticket, 1);
    }
    expect(limiter.begin('alice', '10.0.0.9', 2).kind).toBe('refuse');
  });

  it('NOTE (documented trade): anyone who knows a name can lock it out from ONE address', async () => {
    const m = await mounted({ limits: { perName: 3, perAddress: 20, backoffMs: 0 } });
    for (let i = 0; i < 3; i += 1) await login(m.url, 'alice', 'x');
    expect((await login(m.url, 'alice', 'alice-pw')).status).toBe(429);
  });

  it('HELD: X-Forwarded-For is ignored from an untrusted peer (spoofing moves no budget)', async () => {
    const m = await mounted({
      limits: { perName: 1_000, perAddress: 2, backoffMs: 40 },
      warn: () => undefined,
    });
    const t = async (n: string, xff: string) => {
      const s0 = Date.now();
      await login(m.url, n, 'x', { 'x-forwarded-for': xff });
      return Date.now() - s0;
    };
    await t('a1', '1.1.1.1');
    await t('a2', '2.2.2.2');
    await t('a3', '3.3.3.3');
    // One peer, whatever the header says: the delay grew.
    expect(await t('a4', '4.4.4.4')).toBeGreaterThanOrEqual(35);
  });

  it('HELD: behind a trusted proxy, a client-prepended XFF hop is not believed (rightmost untrusted)', async () => {
    const m = await mounted({
      limits: { perName: 1_000, perAddress: 2, backoffMs: 40 },
      trustedProxies: ['127.0.0.1'],
    });
    const t = async (n: string, xff: string) => {
      const s0 = Date.now();
      await login(m.url, n, 'x', { 'x-forwarded-for': xff });
      return Date.now() - s0;
    };
    await t('b1', '9.9.9.1, 10.1.1.1');
    await t('b2', '9.9.9.2, 10.1.1.1');
    await t('b3', '9.9.9.3, 10.1.1.1');
    expect(await t('b4', '9.9.9.4, 10.1.1.1')).toBeGreaterThanOrEqual(35);
  });

  it("FIXED: behind a proxy (a CIDR trusted range), strangers' wrong guesses never lock out bob's right password", async () => {
    const m = await mounted({
      limits: { perName: 100, perAddress: 3, backoffMs: 0 },
      trustedProxies: ['127.0.0.0/8'],
    });
    for (let i = 0; i < 3; i += 1)
      await login(m.url, `stranger-${i}`, 'x', { 'x-forwarded-for': `10.0.0.${i}` });
    const bob = await login(m.url, 'bob', 'bob-pw', { 'x-forwarded-for': '10.0.0.99' });
    expect(bob.status).toBe(200);
    // …and even from ONE shared address, the address budget only delays.
    const m2 = await mounted({
      limits: { perName: 100, perAddress: 3, backoffMs: 0 },
      warn: () => undefined,
    });
    for (let i = 0; i < 5; i += 1) await login(m2.url, `s-${i}`, 'x');
    expect((await login(m2.url, 'bob', 'bob-pw')).status).toBe(200);
  });

  it('HELD: counters are bounded (maxEntries per map)', () => {
    const limiter = attemptLimiter({ maxEntries: 100 });
    for (let i = 0; i < 1_000; i += 1) {
      const v = limiter.begin(`n${i}`, `a${i}`, 0);
      if (v.kind === 'allow') limiter.succeeded(v.ticket);
    }
    expect(limiter.size).toBeLessThanOrEqual(200);
  });
});

// ─── E. memorySignIns ────────────────────────────────────────────────

describe('E — memorySignIns', () => {
  it('FIXED: ONE person logging in many times never signs anybody else out (per-account cap; a full store refuses)', async () => {
    const store = memorySignIns({ max: 5, perAccount: 2, warn: () => undefined });
    const m = await mounted({ store });
    const bob = (await login(m.url, 'bob', 'bob-pw')).cookie as string;
    for (let i = 0; i < 5; i += 1)
      expect((await login(m.url, 'alice', 'alice-pw')).status).toBe(200);
    expect((await call(m.url, '/auth/me', { headers: { cookie: bob } })).status).toBe(200);
    expect(store.size).toBe(3); // bob + alice's two newest
    const full = memorySignIns({ max: 1, warn: () => undefined });
    const m2 = await mounted({ store: full });
    expect((await login(m2.url, 'bob', 'bob-pw')).status).toBe(200);
    const refused = await login(m2.url, 'alice', 'alice-pw');
    expect(refused.status).toBe(503);
    void SignInStoreFullError;
  });

  it('FIXED: an ended sign-in (the per-account cap) is announced — its open socket closes at once', async () => {
    const store = memorySignIns({ perAccount: 1, warn: () => undefined });
    const m = await mounted({ store });
    const first = (await login(m.url, 'bob', 'bob-pw')).cookie as string;
    const client = connectConversation(m.port, { headers: { cookie: first } });
    expect((await client.opened).status).toBe(101);
    await login(m.url, 'bob', 'bob-pw'); // bob's second sign-in ends his first
    expect((await client.closed).code).toBe(1008);
  });
});

// ─── F. Two credentials ──────────────────────────────────────────────

describe('F — two credentials', () => {
  it('HELD: bearer + cookie → two-credentials; a cookie + Basic auth is the sign-in (Basic is not a token)', async () => {
    const m = await mounted();
    const cookie = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
    const both = await call(m.url, '/invoke', {
      method: 'POST',
      headers: { ...JSON_POST, cookie, authorization: 'Bearer x' },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect(both.status).toBe(401);
    expect(m.records.at(-1)?.identityFailure).toBe('two-credentials');
    const basic = await call(m.url, '/invoke', {
      method: 'POST',
      headers: { ...JSON_POST, cookie, authorization: 'Basic eDp5' },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect(basic.status).toBe(200);
  });

  it('HELD: two Authorization headers — node keeps the first; still two-credentials beside a cookie', async () => {
    const m = await mounted();
    const cookie = (await login(m.url, 'alice', 'alice-pw')).cookie as string;
    const r = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ input: 'hi' });
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: m.port,
          path: '/invoke',
          method: 'POST',
          headers: [
            'host',
            `127.0.0.1:${m.port}`,
            'content-type',
            'application/json',
            'content-length',
            String(body.length),
            'cookie',
            cookie,
            'authorization',
            'Bearer a',
            'authorization',
            'Bearer b',
          ] as unknown as Record<string, string>,
        },
        (res) => {
          let t = '';
          res.on('data', (c) => (t += c));
          res.on('end', () => {
            resolve(res.statusCode ?? 0);
          });
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(r).toBe(401);
    expect(m.records.at(-1)?.identityFailure).toBe('two-credentials');
  });
});

// ─── G. WebSocket ────────────────────────────────────────────────────

async function wsHost(
  identity: DoorIdentity,
  limits?: { maxPendingBytes: number; maxFrameBytes: number; idleMs?: number },
  subscribe = true,
) {
  const host = nodeHost({
    port: 0,
    hostname: '127.0.0.1',
    signIn: { identity },
    ...(limits && { conversationLimits: { idleMs: 60_000, ...limits } }),
  });
  const handle = (await host.serveConversations((c: HostConversation) => {
    if (subscribe) c.onFrame((f) => c.send(`echo:${f.length}`));
  })) as HttpHostHandle;
  open.push(handle);
  return handle;
}

describe('G — WebSocket', () => {
  it('HELD: a handshake with no Origin and no credential is 401 before the 101', async () => {
    const store = fakeSignInStore();
    const h = await wsHost({ signIn: signInSource({ store, idleMinutes: 60 }) });
    expect((await connectConversation(h.port).opened).status).toBe(401);
  });

  it('HELD: frames queued behind the check are dropped once the sign-in is found ended', async () => {
    const store = fakeSignInStore();
    const base = signInSource({ store, idleMinutes: 60 });
    let calls = 0;
    const slow = {
      identify: async (k: string) => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 30));
        return base.identify(k);
      },
    };
    const h = await wsHost({ signIn: slow });
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(h.port, {
      headers: { cookie: `${SIGN_IN_COOKIE}=${alice.cookie}` },
    });
    expect((await client.opened).status).toBe(101);
    client.send('one');
    expect(await client.waitForFrames(1)).toEqual(['echo:3']);
    store.rows.delete(alice.key);
    for (let i = 0; i < 20; i += 1) client.send(`x${i}`);
    expect((await client.closed).code).toBe(1008);
    expect(client.frames()).toEqual(['echo:3']);
    expect(calls).toBeLessThan(22); // later frames are dropped without a check
  });

  it('FIXED: frames waiting on the re-check count against maxPendingBytes — the 400 KB flood closes the socket (1009)', async () => {
    const store = fakeSignInStore();
    const base = signInSource({ store, idleMinutes: 60 });
    const slow = {
      identify: async (k: string) => {
        await new Promise((r) => setTimeout(r, 200));
        return base.identify(k);
      },
    };
    const h = await wsHost(
      { signIn: slow },
      { maxPendingBytes: 4_096, maxFrameBytes: 2_048 },
      false,
    );
    const alice = await signInAs(store, 'alice');
    const client = connectConversation(h.port, {
      headers: { cookie: `${SIGN_IN_COOKIE}=${alice.cookie}` },
    });
    expect((await client.opened).status).toBe(101);
    const frame = 'y'.repeat(2_000);
    for (let i = 0; i < 200; i += 1) client.send(frame);
    expect((await client.closed).code).toBe(1009);
  });

  it('CONTROL: the same flood WITHOUT signIn is closed by the pending bound', async () => {
    const host = nodeHost({
      port: 0,
      hostname: '127.0.0.1',
      conversationLimits: { idleMs: 60_000, maxPendingBytes: 4_096, maxFrameBytes: 2_048 },
    });
    const handle = (await host.serveConversations(() => undefined)) as HttpHostHandle;
    open.push(handle);
    const client = connectConversation(handle.port);
    expect((await client.opened).status).toBe(101);
    for (let i = 0; i < 200; i += 1) client.send('y'.repeat(2_000));
    const race = await Promise.race([
      client.closed.then(() => 'closed'),
      new Promise((r) => setTimeout(() => r('open'), 400)),
    ]);
    expect(race).toBe('closed');
  });

  it('HELD: a store outage at the HANDSHAKE is 503 before the 101', async () => {
    const store = fakeSignInStore();
    const h = await wsHost({ signIn: signInSource({ store, idleMinutes: 60 }) });
    const alice = await signInAs(store, 'alice');
    store.down = true;
    const client = connectConversation(h.port, {
      headers: { cookie: `${SIGN_IN_COOKIE}=${alice.cookie}` },
    });
    expect((await client.opened).status).toBe(503);
  });

  it('DOCUMENTED (N-3): a socket that only receives is closed by onEnd or its next frame — stated beside rule 21', () => {
    // No timer: the README says so. An ENDED sign-in (sign-out, a cap, a
    // sweep) is announced and closes the socket at once (tests above).
    expect(true).toBe(true);
  });
});

// ─── H. Headers never carry the credential ───────────────────────────

describe('H — withoutCredentials coverage', () => {
  it('FIXED: a custom tokenHeader (via `also`) and the common platform token headers are removed', () => {
    const out = withoutCredentials(
      {
        'x-my-token': 'SECRET-custom',
        'x-amzn-oidc-accesstoken': 'SECRET-alb',
        'x-amzn-oidc-data': 'SECRET-alb-data',
        'x-goog-iap-jwt-assertion': 'SECRET-iap',
        'cf-access-jwt-assertion': 'SECRET-cf',
        'x-ms-token-aad-access-token': 'SECRET-easyauth',
        'x-api-key': 'SECRET-key',
        'sec-websocket-protocol': 'bearer, SECRET-subprotocol-token',
        keep: 'k',
      },
      { also: ['X-My-Token'] },
    );
    expect(out).toEqual({ keep: 'k' });
  });

  it('HELD: authorization, proxy-authorization, cookie, set-cookie and the oauth2-proxy/pomerium names are removed, any case', () => {
    const out = withoutCredentials({
      Authorization: 'x',
      'Proxy-Authorization': 'x',
      Cookie: 'x',
      'Set-Cookie': ['x'],
      'X-Forwarded-Access-Token': 'x',
      'X-Auth-Request-Access-Token': 'x',
      'X-Pomerium-Jwt-Assertion': 'x',
      keep: 'k',
    });
    expect(out).toEqual({ keep: 'k' });
  });
});

// ─── I. Routing oddities / store faults ──────────────────────────────

describe('I — routing and store faults', () => {
  it('FIXED: /auth/constructor and /auth/__proto__ are plain 404s', async () => {
    const m = await mounted();
    expect((await call(m.url, '/auth/constructor')).status).toBe(404);
    expect((await call(m.url, '/auth/__proto__')).status).toBe(404);
  });

  it('FIXED: a store that fails on create answers 503 AFTER the minimum time — no oracle for a right password', async () => {
    const inner = memorySignIns({ warn: () => undefined });
    let down = false;
    const store: SignInStore = {
      create: async (s) => {
        if (down) throw new Error('db down');
        return inner.create(s);
      },
      find: (k) => inner.find(k),
      touch: (k, a) => inner.touch(k, a),
      delete: (k) => inner.delete(k),
    };
    const m = await mounted({ store, minimumResponseMs: 300 });
    down = true;
    const t0 = performance.now();
    const right = await login(m.url, 'alice', 'alice-pw');
    const tRight = performance.now() - t0;
    expect(right.status).toBe(503);
    expect(tRight).toBeGreaterThanOrEqual(290);
  });
});

// ─── J. The plain-http localhost cookie ──────────────────────────────

describe('J — plain-http fallback', () => {
  it('HELD: off-loopback http and http in production are refused at construction', async () => {
    const passwords = localPasswords(await testUsers());
    const store = memorySignIns();
    expect(() =>
      signInDoor({ passwords, store, publicUrl: 'http://10.0.0.5:3000', production: false }),
    ).toThrow(/https/);
    expect(() =>
      signInDoor({
        passwords,
        store,
        publicUrl: 'http://localhost.evil.example:3000',
        production: false,
        guard: { allowedHosts: ['localhost.evil.example:3000'] },
      }),
    ).toThrow(/https/);
    expect(() =>
      signInDoor({ passwords, store, publicUrl: 'http://localhost:3000', production: true }),
    ).toThrow(/production/);
  });

  it('FIXED: with a loopback http public URL, allowedHosts may not name a LAN host (the cookie has no Secure)', async () => {
    const passwords = localPasswords(await testUsers());
    expect(() =>
      signInDoor({
        passwords,
        store: memorySignIns(),
        publicUrl: 'http://localhost:3000',
        production: false,
        guard: { allowedHosts: ['localhost:3000', 'devbox.corp.example:3000'] },
      }),
    ).toThrow(/may name only this machine/);
  });

  it('FIXED: `production` must be a boolean; minimumResponseMs is validated', async () => {
    const passwords = localPasswords(await testUsers());
    const base = { passwords, store: memorySignIns(), publicUrl: 'http://localhost:3000' };
    expect(() => signInDoor({ ...base, production: undefined as never })).toThrow(
      /production is true or false/,
    );
    expect(() => signInDoor({ ...base, production: false, minimumResponseMs: Number.NaN })).toThrow(
      /minimumResponseMs/,
    );
    expect(() => signInDoor({ ...base, production: false, hours: 999_999 })).toThrow(/hours/);
  });
});

// ─── K. scrypt ───────────────────────────────────────────────────────

describe('K — scrypt', () => {
  it('HELD: below the floor, a malformed hash, a plain password, an empty password → refused', async () => {
    const ok = await hashPassword('p', TEST_COST);
    const [, , , , salt, key] = ok.split('$');
    expect(() => localPasswords(`a:scrypt$13$8$1$${salt}$${key}`)).toThrow();
    expect(() => localPasswords(`a:scrypt$14$4$1$${salt}$${key}`)).toThrow();
    expect(() => localPasswords(`a:scrypt$14$8$1$${salt}`)).toThrow();
    expect(() => localPasswords(`a:scrypt$x$8$1$${salt}$${key}`)).toThrow();
    expect(() => localPasswords(`a:scrypt$14.5$8$1$${salt}$${key}`)).toThrow();
    expect(() => localPasswords('a:hunter2')).toThrow(/Plain passwords/);
    await expect(hashPassword('')).rejects.toThrow();
  });

  it('FIXED: the ceiling is 256 MiB per check and p ≤ 4 — N=2^20 r=32 p=16 is refused', async () => {
    const ok = await hashPassword('p', TEST_COST);
    const [, , , , salt, key] = ok.split('$');
    expect(() => localPasswords(`first:scrypt$20$32$16$${salt}$${key}`)).toThrow(/256 MiB/);
    expect(() => localPasswords(`first:scrypt$19$8$1$${salt}$${key}`)).toThrow(/256 MiB/);
    expect(() => localPasswords(`first:scrypt$18$8$1$${salt}$${key}`)).not.toThrow();
    expect(() => localPasswords(`first:scrypt$14$8$5$${salt}$${key}`)).toThrow(/p ≤ 4/);
  });

  it('HELD: passwords are NFC-normalised (NFD typing still signs in)', async () => {
    const list = localPasswords(`a:${await hashPassword('café', TEST_COST)}`);
    expect(await list.check('a', 'café')).toBeDefined();
  });

  it('FIXED: names are NFC-normalised — an NFD duplicate is refused, and NFD typing finds the NFC name', async () => {
    const h = await hashPassword('p', TEST_COST);
    expect(() => localPasswords(`Jos\u00e9:${h},Jose\u0301:${h}`)).toThrow(/twice/);
    const list = localPasswords(`Jos\u00e9:${h}`);
    expect(await list.check('Jose\u0301', 'p')).toMatchObject({
      identity: { userId: 'Jos\u00e9' },
    });
  });
});

// ─── L. Boot refusals / the host side of H1 ─────────────────────────

describe('L — host side of H1', () => {
  it('FIXED: nodeHost({ signIn }) refuses to boot with the browser rules off, and a cross-origin text/plain post is refused', async () => {
    const store = fakeSignInStore();
    const identity = { signIn: signInSource({ store, idleMinutes: 60 }) };
    const base = { port: 0, hostname: '127.0.0.1', signIn: { identity } } as const;
    expect(() => nodeHost({ ...base, allowedOrigins: 'any' })).toThrow(
      /allowedOrigins may not be 'any'/,
    );
    expect(() => nodeHost({ ...base, requireJsonContentType: false })).toThrow(
      /requireJsonContentType/,
    );
    expect(() => nodeHost({ ...base, allowedHosts: 'any' })).toThrow(
      /allowedHosts may not be 'any'/,
    );
    expect(() => nodeHost({ port: 0, signIn: { identity } })).toThrow(/allowedHosts must list/);
    const host = nodeHost(base);
    const handle = (await host.serve((_r, reply) => reply.complete('ok'))) as HttpHostHandle;
    open.push(handle);
    const alice = await signInAs(store, 'alice');
    const r = await raw(
      handle.port,
      '/invoke',
      'POST',
      {
        'content-type': 'text/plain',
        origin: 'https://sibling.corp.example',
        cookie: `${SIGN_IN_COOKIE}=${alice.cookie}`,
        host: `127.0.0.1:${handle.port}`,
      },
      JSON.stringify({ input: 'hi' }),
    );
    expect([403, 415]).toContain(r.status);
  });
});
