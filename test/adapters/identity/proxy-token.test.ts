/**
 * proxy-token — an authenticating reverse proxy forwards an ACCESS token, and
 * the library verifies it (design §4.4, §9 step 6). 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI)
 * against a FAKE proxy over real HTTP.
 *
 * The laws being pinned:
 *   • No discovery: a literal issuer, a JWKS URL (https; never through a
 *     redirect), the configured header.
 *   • Only an ACCESS token for this API — `id-token` is refused at boot, and an
 *     ID token forwarded anyway is refused at the door.
 *   • The person test and the client check (the proxy's client).
 *   • Every door is hardened: no host guard lists → refuses to start.
 *   • A spoofed forwarded header straight at the app port is refused.
 */

import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  memorySessions,
  nodeHost,
  standingAgent,
  type HostHandle,
  type IngressRecord,
} from '../../../src/doors/hosting.js';
import {
  identityConfigFromEnv,
  identityFromConfig,
  type IdentityConfig,
} from '../../../src/identity.js';
import {
  appOnlyClaims,
  fakeIdp,
  personClaims,
  seconds,
  type FakeIdp,
} from './conformance/fakeIdp.js';
import { IDS, SHAPE_DEFAULTS } from './conformance/harnesses.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

const ISSUER = 'proxy.corp.example';
const JWKS = 'https://proxy.corp.example/.well-known/jwks.json';

function proxyConfig(extra: Partial<IdentityConfig> = {}): IdentityConfig {
  return {
    strategy: 'proxy-token',
    proxyToken: 'access-token',
    issuer: ISSUER,
    jwksUrl: JWKS,
    audience: SHAPE_DEFAULTS.audience,
    userIdClaim: 'oid',
    requiredScope: SHAPE_DEFAULTS.scope,
    allowedClients: [SHAPE_DEFAULTS.client],
    publicUrl: 'https://neo.corp.example',
    ...extra,
  };
}

const LISTS = { allowedHosts: ['neo.corp.example', '127.0.0.1'] as const };

async function refusal(run: () => Promise<unknown>): Promise<{ key?: string; message: string }> {
  try {
    await run();
  } catch (err) {
    return err as { key?: string; message: string };
  }
  throw new Error('expected a refusal');
}

/**
 * The app (standingAgent) behind a FAKE authenticating proxy. The proxy signs
 * people in with its own cookie (`proxy-session=<user>`), drops whatever the
 * client sent in the token header, and forwards the person's ACCESS token.
 */
async function appBehindProxy(idp: FakeIdp, extra: Partial<IdentityConfig> = {}) {
  const choice = await identityFromConfig(proxyConfig(extra), {
    production: true,
    backend: idp.backend,
    crossSite: { allowedHosts: [...LISTS.allowedHosts] },
  });
  const records: IngressRecord[] = [];
  const handle = (await standingAgent({
    agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
    sessions: memorySessions(),
    host: nodeHost({ port: 0, hostname: '127.0.0.1', allowedHosts: [...LISTS.allowedHosts] }),
    identity: choice.identity,
    onIngressDecision: (r) => records.push(r),
  })) as HostHandle & { url: string; port: number };
  closers.push(() => handle.close());
  const header = (extra.proxyHeader ?? 'authorization').toLowerCase();
  const tokenFor = async (user: string): Promise<string | undefined> =>
    user === 'alice' || user === 'bob'
      ? idp.sign(
          personClaims({ issuer: ISSUER, ...SHAPE_DEFAULTS }, user === 'alice' ? IDS.a : IDS.b),
        )
      : undefined;
  const proxy: Server = createServer((req, res) => {
    void (async () => {
      const user = /proxy-session=([a-z]+)/.exec(req.headers.cookie ?? '')?.[1];
      const token = user === undefined ? undefined : await tokenFor(user);
      if (token === undefined)
        return void res.writeHead(302, { location: '/oauth2/sign_in' }).end();
      const headers = { ...req.headers, host: 'neo.corp.example' };
      delete headers[header];
      delete headers.cookie;
      headers[header] = header === 'authorization' ? `Bearer ${token}` : token;
      const upstream = request(
        { host: '127.0.0.1', port: handle.port, path: req.url, method: req.method, headers },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      req.pipe(upstream);
    })();
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => proxy.close(() => r())));
  return {
    choice,
    handle,
    records,
    proxyUrl: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
  };
}

const invoke = (url: string, headers: Record<string, string>) =>
  fetch(`${url}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ input: 'hi' }),
  });

// ─── 1. UNIT — the boot refusals ─────────────────────────────────────

describe('proxy-token — boot refusals', () => {
  it('IDENTITY_PROXY_TOKEN: id-token refused (with the fix named), missing refused', async () => {
    const idp = await fakeIdp(ISSUER);
    const boot = {
      production: false,
      backend: idp.backend,
      crossSite: { allowedHosts: [...LISTS.allowedHosts] },
    };
    const id = await refusal(() =>
      identityFromConfig(proxyConfig({ proxyToken: 'id-token' }), boot),
    );
    expect(id.key).toBe('IDENTITY_PROXY_TOKEN');
    expect(id.message).toMatch(/ACCESS token/);
    const none = await refusal(() =>
      identityFromConfig(proxyConfig({ proxyToken: undefined }), boot),
    );
    expect(none.key).toBe('IDENTITY_PROXY_TOKEN');
  });

  it('needs a JWKS URL (https; loopback http only outside production) and a public URL', async () => {
    const idp = await fakeIdp(ISSUER);
    const boot = {
      production: true,
      backend: idp.backend,
      crossSite: { allowedHosts: [...LISTS.allowedHosts] },
    };
    expect(
      (await refusal(() => identityFromConfig(proxyConfig({ jwksUrl: undefined }), boot))).key,
    ).toBe('IDENTITY_JWKS_URL');
    expect(
      (
        await refusal(() =>
          identityFromConfig(proxyConfig({ jwksUrl: 'http://127.0.0.1:9/keys' }), boot),
        )
      ).key,
    ).toBe('IDENTITY_JWKS_URL');
    expect(
      (await refusal(() => identityFromConfig(proxyConfig({ publicUrl: undefined }), boot))).key,
    ).toBe('IDENTITY_PUBLIC_URL');
  });

  it('EVERY DOOR IS HARDENED: no host guard lists, or "any", refuses to start', async () => {
    const idp = await fakeIdp(ISSUER);
    const unguarded = await refusal(() =>
      identityFromConfig(proxyConfig(), { production: true, backend: idp.backend }),
    );
    expect(unguarded.message).toMatch(/allowedHosts is required/);
    const any = await refusal(() =>
      identityFromConfig(proxyConfig(), {
        production: true,
        backend: idp.backend,
        crossSite: { allowedHosts: 'any' },
      }),
    );
    expect(any.message).toMatch(/'any'/);
    const noJson = await refusal(() =>
      identityFromConfig(proxyConfig(), {
        production: true,
        backend: idp.backend,
        crossSite: { allowedHosts: [...LISTS.allowedHosts], requireJsonContentType: false },
      }),
    );
    expect(noJson.message).toMatch(/requireJsonContentType/);
  });

  it("a bare user header is never a token header; browser sign-in keys are not proxy-token's", async () => {
    const idp = await fakeIdp(ISSUER);
    const boot = {
      production: false,
      backend: idp.backend,
      crossSite: { allowedHosts: [...LISTS.allowedHosts] },
    };
    expect(
      (
        await refusal(() =>
          identityFromConfig(proxyConfig({ proxyHeader: 'X-Forwarded-User' }), boot),
        )
      ).key,
    ).toBe('IDENTITY_PROXY_HEADER');
    expect(
      (await refusal(() => identityFromConfig(proxyConfig({ clientId: 'neo-web' }), boot))).message,
    ).toMatch(/belongs to oidc-token, not proxy-token/);
  });

  it('the token header is authorization or a custom x- header — never a standard one or a user name (idI57 recheck)', async () => {
    const idp = await fakeIdp(ISSUER);
    const boot = {
      production: false,
      backend: idp.backend,
      crossSite: { allowedHosts: [...LISTS.allowedHosts] },
    };
    for (const bad of [
      'cookie',
      'Set-Cookie',
      'host',
      'forwarded',
      'x-forwarded-user',
      'X-Forwarded-User-Token',
      'x-',
      'x_token',
    ]) {
      expect(
        (await refusal(() => identityFromConfig(proxyConfig({ proxyHeader: bad }), boot))).key,
        bad,
      ).toBe('IDENTITY_PROXY_HEADER');
    }
    for (const good of [
      'authorization',
      'Authorization',
      'x-forwarded-access-token',
      'x-auth-request-access-token',
    ]) {
      const choice = await identityFromConfig(proxyConfig({ proxyHeader: good }), boot);
      expect(choice.mode, good).toBe('proxy');
    }
  });

  it('the public URL is the origin alone: a path, query or fragment is refused (idI57 recheck)', async () => {
    const idp = await fakeIdp(ISSUER);
    const boot = {
      production: false,
      backend: idp.backend,
      crossSite: { allowedHosts: [...LISTS.allowedHosts] },
    };
    for (const bad of [
      'https://neo.corp.example/app/',
      'https://neo.corp.example/?x=1',
      'https://neo.corp.example/#top',
    ]) {
      expect(
        (await refusal(() => identityFromConfig(proxyConfig({ publicUrl: bad }), boot))).key,
        bad,
      ).toBe('IDENTITY_PUBLIC_URL');
    }
  });
});

// ─── 2. SCENARIO — through the fake proxy ────────────────────────────

describe('proxy-token — scenarios', () => {
  it('alice and bob through the proxy are served as their oid; mode is proxy', async () => {
    const idp = await fakeIdp(ISSUER);
    const app = await appBehindProxy(idp);
    expect(app.choice.mode).toBe('proxy');
    for (const [user, id] of [
      ['alice', IDS.a],
      ['bob', IDS.b],
    ] as const) {
      const res = await invoke(app.proxyUrl, { cookie: `proxy-session=${user}` });
      expect(res.status, user).toBe(200);
      expect(app.records.at(-1)?.userId).toBe(id);
    }
  });

  it('the token in another header (x-forwarded-access-token, raw)', async () => {
    const idp = await fakeIdp(ISSUER);
    const app = await appBehindProxy(idp, { proxyHeader: 'X-Forwarded-Access-Token' });
    expect((await invoke(app.proxyUrl, { cookie: 'proxy-session=alice' })).status).toBe(200);
    expect(app.records.at(-1)?.userId).toBe(IDS.a);
  });

  it('an app-only token, a token for an unlisted client, and an ID token are refused', async () => {
    const idp = await fakeIdp(ISSUER);
    const app = await appBehindProxy(idp);
    const shape = { issuer: ISSUER, ...SHAPE_DEFAULTS };
    const t = seconds.now();
    const idToken = await idp.sign({
      iss: ISSUER,
      aud: SHAPE_DEFAULTS.client,
      sub: 'x',
      oid: IDS.a,
      nonce: 'n',
      iat: t,
      exp: t + 300,
    });
    const cases: [string, string, string][] = [
      ['app-only', await idp.sign(appOnlyClaims(shape)), 'not-a-user-token'],
      [
        'unlisted client',
        await idp.sign(personClaims(shape, IDS.a, { azp: 'another-proxy' })),
        'wrong-client',
      ],
      ['ID token', idToken, 'wrong-audience'],
    ];
    for (const [label, token, failure] of cases) {
      const res = await invoke(app.handle.url, {
        authorization: `Bearer ${token}`,
        host: 'neo.corp.example',
      });
      expect(res.status, label).toBe(401);
      expect(app.records.at(-1)?.identityFailure, label).toBe(failure);
    }
  });
});

// ─── 3. INTEGRATION / SECURITY — straight at the app port ────────────

describe('proxy-token — the app port, reached directly', () => {
  it('a spoofed X-Forwarded-User with no token is refused (no-token); a forged token is unverifiable', async () => {
    const idp = await fakeIdp(ISSUER);
    const app = await appBehindProxy(idp);
    const spoof = await invoke(app.handle.url, {
      'x-forwarded-user': 'alice',
      'x-forwarded-email': 'alice@corp.example',
      host: 'neo.corp.example',
    });
    expect(spoof.status).toBe(401);
    expect(app.records.at(-1)?.identityFailure).toBe('no-token');
    const forged = await idp.sign(personClaims({ issuer: ISSUER, ...SHAPE_DEFAULTS }, IDS.a), {
      key: 'other',
    });
    expect(
      (
        await invoke(app.handle.url, {
          authorization: `Bearer ${forged}`,
          host: 'neo.corp.example',
        })
      ).status,
    ).toBe(401);
    expect(app.records.at(-1)?.identityFailure).toBe('unverifiable');
  });

  it('a forged cross-site request through the proxy carrying the proxy cookie is refused by the door guard', async () => {
    const idp = await fakeIdp(ISSUER);
    const app = await appBehindProxy(idp);
    const res = await fetch(`${app.proxyUrl}/invoke`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        cookie: 'proxy-session=alice',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ input: 'hi' }),
    });
    expect([403, 415]).toContain(res.status);
  });
});

// ─── 4. PROPERTY — only the configured header is ever read ──────────

describe('proxy-token — properties', () => {
  it('with a custom header, a token anywhere else is not read', async () => {
    const idp = await fakeIdp(ISSUER);
    const app = await appBehindProxy(idp, { proxyHeader: 'x-forwarded-access-token' });
    const token = await idp.sign(personClaims({ issuer: ISSUER, ...SHAPE_DEFAULTS }, IDS.a));
    for (const header of [
      'authorization',
      'x-auth-request-access-token',
      'x-pomerium-jwt-assertion',
    ]) {
      const value = header === 'authorization' ? `Bearer ${token}` : token;
      expect(
        (await invoke(app.handle.url, { [header]: value, host: 'neo.corp.example' })).status,
        header,
      ).toBe(401);
    }
  });
});

// ─── 5. SECURITY — the JWKS is never fetched through a redirect ──────

describe('proxy-token — the key set URL', () => {
  it('a JWKS URL that redirects is never followed: tokens are refused', async () => {
    const idp = await fakeIdp(ISSUER);
    const served = await idp.listen();
    closers.push(served.close);
    const bounce: Server = createServer((_req, res) =>
      res.writeHead(302, { location: `${served.issuer}/keys` }).end(),
    );
    await new Promise<void>((r) => bounce.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise<void>((r) => bounce.close(() => r())));
    const choice = await identityFromConfig(
      proxyConfig({
        jwksUrl: `http://127.0.0.1:${(bounce.address() as AddressInfo).port}/keys`,
        publicUrl: 'http://127.0.0.1:18481',
      }),
      { production: false },
    );
    const token = await served.sign(personClaims({ issuer: ISSUER, ...SHAPE_DEFAULTS }, IDS.a));
    await expect(
      (choice.identity as { verify(t: string): Promise<unknown> }).verify(token),
    ).rejects.toBeDefined();
  });
});

// ─── 6. PERFORMANCE — no discovery fetch at all ──────────────────────

describe('proxy-token — performance', () => {
  it('boots without any discovery read', async () => {
    const idp = await fakeIdp(ISSUER);
    await identityFromConfig(proxyConfig(), {
      production: true,
      backend: idp.backend,
      crossSite: { allowedHosts: [...LISTS.allowedHosts] },
      fetch: async () => {
        throw new Error('discovery must not run');
      },
    });
    expect(idp.discoveryReads).toBe(0);
  });
});

// ─── 7. ROI — from the environment ───────────────────────────────────

describe('proxy-token — ROI', () => {
  it('six IDENTITY_* lines plus the host lists; the banner states the port rule', async () => {
    const idp = await fakeIdp(ISSUER);
    const choice = await identityFromConfig(
      identityConfigFromEnv({
        IDENTITY_STRATEGY: 'proxy-token',
        IDENTITY_PROXY_TOKEN: 'access-token',
        IDENTITY_PROXY_HEADER: 'x-forwarded-access-token',
        IDENTITY_ISSUER: ISSUER,
        IDENTITY_JWKS_URL: JWKS,
        IDENTITY_AUDIENCE: SHAPE_DEFAULTS.audience,
        IDENTITY_USER_ID_CLAIM: 'oid',
        IDENTITY_REQUIRED_SCOPE: SHAPE_DEFAULTS.scope,
        IDENTITY_ALLOWED_CLIENTS: SHAPE_DEFAULTS.client,
        IDENTITY_PUBLIC_URL: 'https://neo.corp.example',
      }),
      { production: true, backend: idp.backend, crossSite: { allowedHosts: ['neo.corp.example'] } },
    );
    expect(choice.strategy).toBe('proxy-token');
    expect(choice.banner.join('\n')).toMatch(/reachable ONLY from the proxy/);
    expect(choice.signInDoor).toBeUndefined();
  });
});
