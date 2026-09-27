/**
 * The I-1 security review's attacks, ported as REGRESSION tests (review of
 * d306aa57: 2 BLOCKING, 7 SHOULD-FIX, 8 NIT). Every `FINDING` the review
 * pinned as today's behaviour is asserted here as the FIXED behaviour; the
 * attacks that held are kept so they keep holding.
 *
 *   B-1  allowedClients 'any' refused in production; the Keycloak/Okta
 *        service-account shape is refused by the client check.
 *   B-2  discovery never follows a redirect; http keys refused in production.
 *   S-1  a misconfigured answer after an outage boot is retried (oidc.test.ts).
 *   S-2  the 503 body is a fixed sentence.
 *   S-3  clock tolerance ceiling, 300 s.
 *   S-4  a custom backend's token is checked for EXPIRY, not only presence.
 *   S-5  a platform's IDENTITY_ENDPOINT / IDENTITY_HEADER are skipped, never printed.
 *   S-6  the surviving mutants: http jwks_uri, loopback http in production,
 *        the person test before the id claim.
 *   NITs retry/timeout validated, control characters refused, overage on a
 *        roles path, HS* refused, lower-case keys refused, padded roles kept.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import * as jose from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  identityConfigFromEnv,
  IdentityConfigError,
  identityFromConfig,
  jwksIdentity,
  oidcIdentity,
  type OidcIdentityOptions,
} from '../../../src/identity.js';
import {
  memorySessions,
  nodeHost,
  standingAgent,
  type HostHandle,
  type IngressRecord,
} from '../../../src/doors/hosting.js';
import { fakeIdp, personClaims, seconds, type FakeIdp } from './conformance/fakeIdp.js';
import { IDS, SHAPE_DEFAULTS } from './conformance/harnesses.js';

const shapeOf = (idp: FakeIdp) => ({ issuer: idp.issuer, ...SHAPE_DEFAULTS });

function options(idp: FakeIdp, extra: Partial<OidcIdentityOptions> = {}): OidcIdentityOptions {
  return {
    issuer: idp.issuer,
    audience: SHAPE_DEFAULTS.audience,
    userIdClaim: 'oid',
    requiredScope: SHAPE_DEFAULTS.scope,
    allowedClients: [SHAPE_DEFAULTS.client],
    fetch: idp.fetch,
    backend: idp.backend,
    ...extra,
  };
}

async function outcome(
  verify: (t: string) => Promise<{ userId: string; roles?: readonly string[] }>,
  token: string,
): Promise<string> {
  try {
    const who = await verify(token);
    return `accepted:${who.userId}${who.roles ? `:${JSON.stringify(who.roles)}` : ''}`;
  } catch (err) {
    const e = err as { failure?: string; code?: string; name?: string };
    return `refused:${e.failure ?? e.code ?? e.name}`;
  }
}

const b64u = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

async function bootError(run: () => Promise<unknown>): Promise<IdentityConfigError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof IdentityConfigError) return err;
    throw err;
  }
  throw new Error('expected a boot refusal');
}

const oidcEnv = (idp: FakeIdp, extra: Record<string, string> = {}) =>
  identityConfigFromEnv({
    IDENTITY_STRATEGY: 'oidc-token',
    IDENTITY_ISSUER: idp.issuer,
    IDENTITY_AUDIENCE: SHAPE_DEFAULTS.audience,
    IDENTITY_USER_ID_CLAIM: 'oid',
    IDENTITY_REQUIRED_SCOPE: SHAPE_DEFAULTS.scope,
    IDENTITY_ALLOWED_CLIENTS: SHAPE_DEFAULTS.client,
    ...extra,
  });

// ─── What held, kept holding ─────────────────────────────────────────

describe('A — algorithm tricks (held)', () => {
  it('alg none, HS256 over the published RSA key, embedded jwk, jku/x5u, kid injection are all refused', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(options(idp));
    const claims = personClaims(shapeOf(idp), IDS.a);

    // alg none
    expect(await outcome(v.verify, new jose.UnsecuredJWT(claims).encode())).toBe(
      'refused:unverifiable',
    );

    // HS256 keyed with the published public JWK's bytes (classic confusion)
    const pubJwks = await (
      idp.backend.createRemoteJWKSet(new URL(idp.jwksUri)) as never as (
        h: jose.JWSHeaderParameters,
        t: jose.FlattenedJWSInput,
      ) => Promise<jose.CryptoKey>
    )({ alg: 'RS256', kid: 'k1' }, {} as never);
    const spki = await jose.exportSPKI(pubJwks as never);
    const hs = await new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .sign(new TextEncoder().encode(spki));
    expect(await outcome(v.verify, hs)).toBe('refused:unverifiable');

    // embedded attacker jwk + attacker jku/x5u, claiming the IdP's kid
    const attacker = await jose.generateKeyPair('RS256', { extractable: true });
    const attackerJwk = await jose.exportJWK(attacker.publicKey);
    for (const header of [
      { alg: 'RS256', kid: 'k1', jwk: attackerJwk },
      { alg: 'RS256', kid: 'k1', jku: 'https://evil.example/keys' },
      { alg: 'RS256', kid: 'k1', x5u: 'https://evil.example/cert' },
      { alg: 'RS256', kid: "k1' OR 1=1 --" },
      { alg: 'RS256', kid: '../../../../dev/null' },
      { alg: 'RS256' }, // no kid at all
    ]) {
      const t = await new jose.SignJWT(claims)
        .setProtectedHeader(header as jose.JWTHeaderParameters)
        .sign(attacker.privateKey);
      expect(await outcome(v.verify, t), JSON.stringify(header)).toBe('refused:unverifiable');
    }

    // a real signature with an unknown `crit` header, and b64:false
    const good = await idp.sign(claims);
    const [, body, sigPart] = good.split('.');
    const crit = `${b64u({
      alg: 'RS256',
      kid: 'k1',
      crit: ['x-evil'],
      'x-evil': 1,
    })}.${body}.${sigPart}`;
    expect(await outcome(v.verify, crit)).toBe('refused:unverifiable');
    const b64false = `${b64u({
      alg: 'RS256',
      kid: 'k1',
      b64: false,
      crit: ['b64'],
    })}.${body}.${sigPart}`;
    expect(await outcome(v.verify, b64false)).toBe('refused:unverifiable');
    // a real IdP signature spliced under a DIFFERENT header (kid swap) fails
    const swapped = `${b64u({ alg: 'RS256', kid: 'k1', typ: 'at+jwt' })}.${body}.${sigPart}`;
    expect(await outcome(v.verify, swapped)).toBe('refused:unverifiable');
  });

  it('a structurally odd header never becomes a 503 (an attacker cannot fake an IdP outage)', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(options(idp));
    const sig = 'AAAA';
    const odd: unknown[] = [
      { alg: 123, kid: 'k1' },
      { alg: 'RS256', kid: { a: 1 } },
      { alg: 'RS256', kid: ['k1'] },
      { alg: ['RS256'], kid: 'k1' },
      null,
      [],
      'x',
    ];
    for (const h of odd) {
      const t = `${b64u(h)}.${b64u(personClaims(shapeOf(idp), IDS.a))}.${sig}`;
      expect(await outcome(v.verify, t), JSON.stringify(h)).toBe('refused:unverifiable');
    }
  });
});

// ─── B. Issuer tricks ────────────────────────────────────────────────

describe('B — issuer tricks', () => {
  it('trailing slash / case / other-host issuer: every mismatch is a boot refusal (held)', async () => {
    for (const configured of [
      'https://idp.example.test/tenant/v2.0/',
      'https://IDP.example.test/tenant/v2.0',
      'https://idp.example.test/TENANT/v2.0',
    ]) {
      const idp = await fakeIdp('https://idp.example.test/tenant/v2.0');
      const fetchAny: OidcIdentityOptions['fetch'] = async (url, init) =>
        idp.fetch(
          url
            .replace(/^https:\/\/[^/]+/i, 'https://idp.example.test')
            .replace(/\/\//g, '/')
            .replace('https:/', 'https://')
            .replace('/TENANT/', '/tenant/')
            .replace('v2.0/.well', 'v2.0/.well'),
          init,
        );
      const state = await oidcIdentity(
        options(idp, { issuer: configured, fetch: fetchAny }),
      ).discover();
      expect(state.kind, configured).toBe('misconfigured');
    }
  });

  it('a token whose iss is the issuer with a trailing slash is refused as wrong-issuer (held)', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(options(idp));
    const t = await idp.sign(personClaims(shapeOf(idp), IDS.a, { iss: `${idp.issuer}/` }));
    expect(await outcome(v.verify, t)).toBe('refused:wrong-issuer');
  });

  it('AD FS: the access_token_issuer is accepted ONLY when the document names it (held)', async () => {
    const idp = await fakeIdp();
    const plain = oidcIdentity(options(idp));
    const t = await idp.sign(personClaims(shapeOf(idp), IDS.a, { iss: idp.accessTokenIssuer }));
    expect(await outcome(plain.verify, t)).toBe('refused:wrong-issuer');
    const adfsIdp = await fakeIdp();
    adfsIdp.discovery('adfs');
    const adfs = oidcIdentity(options(adfsIdp));
    const t2 = await adfsIdp.sign(
      personClaims(shapeOf(adfsIdp), IDS.a, { iss: adfsIdp.accessTokenIssuer }),
    );
    expect(await outcome(adfs.verify, t2)).toBe(`accepted:${IDS.a}`);
  });
});

describe('F — the id claim', () => {
  it('missing / number / object / array / empty → refused; whitespace-only and padded ids are taken as bytes', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(options(idp));
    const s = shapeOf(idp);
    for (const oid of [undefined, 42, { v: 'x' }, ['x'], '', null, true]) {
      expect(
        await outcome(v.verify, await idp.sign(personClaims(s, IDS.a, { oid }))),
        JSON.stringify(oid),
      ).toBe('refused:unverifiable');
    }
    expect(await outcome(v.verify, await idp.sign(personClaims(s, IDS.a, { oid: '   ' })))).toBe(
      'accepted:   ',
    );
    expect(
      await outcome(v.verify, await idp.sign(personClaims(s, IDS.a, { oid: 'a\u0000b' }))),
    ).toBe('accepted:a\u0000b');
  });

  it('prototype keys as the id claim never produce an id from Object.prototype (held)', async () => {
    const idp = await fakeIdp();
    const s = shapeOf(idp);
    for (const claim of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const v = oidcIdentity(options(idp, { userIdClaim: claim }));
      expect(await outcome(v.verify, await idp.sign(personClaims(s, IDS.a))), claim).toBe(
        'refused:unverifiable',
      );
    }
  });

  it('a roles PATH through prototype keys reaches no string (held: claimAt stops at non-objects)', async () => {
    const idp = await fakeIdp();
    for (const path of [
      ['constructor', 'name'],
      ['__proto__', 'constructor', 'name'],
      ['toString', 'name'],
      ['__proto__'],
    ]) {
      const v = oidcIdentity(options(idp, { rolesClaim: path }));
      expect(
        await outcome(
          v.verify,
          await idp.sign(personClaims(shapeOf(idp), IDS.a, { roles: undefined })),
        ),
        JSON.stringify(path),
      ).toBe(`accepted:${IDS.a}`);
    }
    // …and the env form reaches it too.
    const config = identityConfigFromEnv({ IDENTITY_ROLES_CLAIM: '["constructor","name"]' });
    expect(config.rolesClaim).toEqual(['constructor', 'name']);
  });
});

// ─── G. Roles ────────────────────────────────────────────────────────

describe('G — roles, overage on a path too (N-5)', () => {
  it('an object roles claim is absent; overage via _claim_names is roles-unknown, for a name AND a path', async () => {
    const idp = await fakeIdp();
    const s = shapeOf(idp);
    const v = oidcIdentity(options(idp));
    expect(
      await outcome(v.verify, await idp.sign(personClaims(s, IDS.a, { roles: { admin: true } }))),
    ).toBe(`accepted:${IDS.a}`);
    expect(
      await outcome(
        v.verify,
        await idp.sign(personClaims(s, IDS.a, { _claim_names: { roles: 's1' } })),
      ),
    ).toBe('refused:roles-unknown');
    const path = oidcIdentity(options(idp, { rolesClaim: ['realm_access', 'roles'] }));
    expect(
      await outcome(
        path.verify,
        await idp.sign(personClaims(s, IDS.a, { _claim_names: { realm_access: 's1' } })),
      ),
    ).toBe('refused:roles-unknown');
    const groups = oidcIdentity(options(idp, { rolesClaim: ['groups'] }));
    expect(
      await outcome(groups.verify, await idp.sign(personClaims(s, IDS.a, { hasgroups: true }))),
    ).toBe('refused:roles-unknown');
    expect(
      await outcome(groups.verify, await idp.sign(personClaims(s, IDS.a, { hasgroups: 'true' }))),
    ).toBe(`accepted:${IDS.a}`);
  });
});

// ─── B-1 ─────────────────────────────────────────────────────────────

describe("B-1 — 'any' clients in production; the service-account shape", () => {
  /** A Keycloak client-credentials token: the API's scope PRESENT, azp = the daemon, no oid. */
  const serviceAccount = async (idp: FakeIdp, claim = 'sub') => {
    const t = seconds.now();
    return idp.sign({
      iss: idp.issuer,
      aud: SHAPE_DEFAULTS.audience,
      azp: 'some-daemon',
      scope: `profile email ${SHAPE_DEFAULTS.scope}`,
      [claim]: 'svc-7c1d',
      preferred_username: 'service-account-some-daemon',
      iat: t,
      exp: t + 300,
    });
  };

  it('FIXED: IDENTITY_ALLOWED_CLIENTS=any refuses to boot in production', async () => {
    const idp = await fakeIdp();
    const err = await bootError(() =>
      identityFromConfig(
        oidcEnv(idp, { IDENTITY_ALLOWED_CLIENTS: 'any', IDENTITY_USER_ID_CLAIM: 'sub' }),
        {
          production: true,
          fetch: idp.fetch,
          backend: idp.backend,
        },
      ),
    );
    expect(err.key).toBe('IDENTITY_ALLOWED_CLIENTS');
  });

  it('the service account is refused wrong-client by a listed client check', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(options(idp, { scopeClaim: 'scope', userIdClaim: 'sub' }));
    expect(await outcome(v.verify, await serviceAccount(idp))).toBe('refused:wrong-client');
  });

  it('with a directory id claim (objectguid), even an over-broad client list refuses it: a service account has none', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(
      options(idp, {
        scopeClaim: 'scope',
        userIdClaim: 'objectguid',
        allowedClients: [SHAPE_DEFAULTS.client, 'some-daemon'],
      }),
    );
    expect(await outcome(v.verify, await serviceAccount(idp))).toBe('refused:unverifiable');
  });
});

// ─── B-2 ─────────────────────────────────────────────────────────────

describe('B-2 — discovery never follows a redirect; http keys in production', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    servers.length = 0;
  });
  const listen = async (handler: Parameters<typeof createServer>[1]): Promise<string> => {
    const s = createServer(handler);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };

  it('FIXED: a redirect to another origin is MISCONFIGURED, over real sockets', async () => {
    let issuer = '';
    let served = 0;
    const elsewhere = await listen((_req, res) => {
      served += 1;
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ issuer, jwks_uri: 'https://attacker-keys.example/jwks' }));
    });
    const base = await listen((_req, res) => {
      res.writeHead(302, { location: `${elsewhere}/doc.json` }).end();
    });
    issuer = `${base}/realm`;
    const idp = await fakeIdp(issuer);
    const state = await oidcIdentity({
      ...options(idp),
      fetch: undefined,
      allowLoopbackHttp: true,
    }).discover();
    expect(state.kind).toBe('misconfigured');
    expect(state.kind === 'misconfigured' && state.check).toMatch(/redirected \(HTTP 302\)/);
    expect(served).toBe(0);
  });

  it('FIXED: a production boot whose discovery redirects refuses to boot', async () => {
    const idp = await fakeIdp();
    const redirecting: OidcIdentityOptions['fetch'] = async () => ({
      status: 301,
      text: async () => '',
    });
    const err = await bootError(() =>
      identityFromConfig(oidcEnv(idp), {
        production: true,
        fetch: redirecting,
        backend: idp.backend,
      }),
    );
    expect(err.message).toMatch(/redirected/);
  });

  it('S-6 (M13): a document naming an http jwks_uri is misconfigured', async () => {
    const idp = await fakeIdp();
    const doc: OidcIdentityOptions['fetch'] = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({ issuer: idp.issuer, jwks_uri: 'http://keys.example.test/jwks' }),
    });
    const state = await oidcIdentity(options(idp, { fetch: doc })).discover();
    expect(state.kind).toBe('misconfigured');
    expect(state.kind === 'misconfigured' && state.check).toMatch(/jwks_uri .* plain http/);
  });

  it('S-6 (M14): loopback http keys boot outside production, and are refused in production', async () => {
    const idp = await fakeIdp();
    const doc: OidcIdentityOptions['fetch'] = async () => ({
      status: 200,
      text: async () => JSON.stringify({ issuer: idp.issuer, jwks_uri: 'http://127.0.0.1:9/keys' }),
    });
    const dev = await identityFromConfig(oidcEnv(idp), {
      production: false,
      fetch: doc,
      backend: idp.backend,
    });
    expect(dev.strategy).toBe('oidc-token');
    const err = await bootError(() =>
      identityFromConfig(oidcEnv(idp), { production: true, fetch: doc, backend: idp.backend }),
    );
    expect(err.message).toMatch(/jwks_uri/);
    // and a configured http override is refused in production by name
    const override = await bootError(() =>
      identityFromConfig(oidcEnv(idp, { IDENTITY_JWKS_URL: 'http://127.0.0.1:9/keys' }), {
        production: true,
        fetch: idp.fetch,
        backend: idp.backend,
      }),
    );
    expect(override.key).toBe('IDENTITY_JWKS_URL');
  });
});

// ─── S-2 ─────────────────────────────────────────────────────────────

describe('S-2 — the 503 body is a fixed sentence', () => {
  const handles: HostHandle[] = [];
  afterEach(async () => {
    await Promise.allSettled(handles.map((h) => h.close()));
    handles.length = 0;
  });

  it('FIXED: an anonymous caller learns neither the discovery URL nor the IdP document values', async () => {
    const idp = await fakeIdp('https://fs.internal.corp.example/adfs');
    idp.discovery('down');
    const records: IngressRecord[] = [];
    const choice = await identityFromConfig(oidcEnv(idp), {
      production: true,
      fetch: idp.fetch,
      backend: idp.backend,
    });
    const handle = await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
      sessions: memorySessions(),
      host: nodeHost({ port: 0, hostname: '127.0.0.1' }),
      identity: choice.identity,
      onIngressDecision: (r) => records.push(r),
    });
    handles.push(handle);
    const res = await fetch(`${handle.url}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x.y.z' },
      body: JSON.stringify({ input: 'hi', sessionId: 's1' }),
    });
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).toContain('discovery failed');
    expect(text).not.toContain('fs.internal');
    expect(text).not.toContain('openid-configuration');
    expect(JSON.stringify(records)).not.toContain('fs.internal');
  });

  it('FIXED: the misconfigured 503 carries no document value either', async () => {
    const idp = await fakeIdp();
    idp.discovery('other-issuer');
    const err = await oidcIdentity(options(idp))
      .verify('x')
      .catch((e: Error) => e);
    expect((err as Error).message).toMatch(/identity is misconfigured/);
    expect((err as Error).message).not.toContain(idp.issuer);
  });
});

// ─── S-3, S-4 ────────────────────────────────────────────────────────

describe('S-3 / S-4 — clock tolerance ceiling; expiry checked for any backend', () => {
  it('FIXED: a tolerance above 300 s refuses at boot and at construction; 300 is accepted', async () => {
    const idp = await fakeIdp();
    const err = await bootError(() =>
      identityFromConfig(oidcEnv(idp, { IDENTITY_CLOCK_TOLERANCE_SECONDS: '999999' }), {
        production: true,
        fetch: idp.fetch,
        backend: idp.backend,
      }),
    );
    expect(err.key).toBe('IDENTITY_CLOCK_TOLERANCE_SECONDS');
    expect(() => oidcIdentity(options(idp, { clockToleranceSeconds: 1e9 }))).toThrow(
      /0 to 300 seconds/,
    );
    expect(() => oidcIdentity(options(idp, { clockToleranceSeconds: 300 }))).not.toThrow();
  });

  it('FIXED: a custom backend that skips time checks still cannot pass an expired or not-yet-valid token', async () => {
    const idp = await fakeIdp();
    const t = seconds.now();
    const lenient = jwksIdentity({
      jwksUrl: idp.jwksUri,
      issuer: idp.issuer,
      audience: SHAPE_DEFAULTS.audience,
      userIdClaim: 'oid',
      backend: {
        createRemoteJWKSet: () => ({}),
        jwtVerify: async (token) => ({ payload: jose.decodeJwt(token) as Record<string, unknown> }),
      },
    });
    const expired = await idp.sign(
      personClaims(shapeOf(idp), IDS.a, { iat: t - 7200, exp: t - 3600 }),
    );
    expect(await outcome(lenient.verify, expired)).toBe('refused:expired');
    const early = await idp.sign(
      personClaims(shapeOf(idp), IDS.a, { nbf: t + 3600, exp: t + 7200 }),
    );
    expect(await outcome(lenient.verify, early)).toBe('refused:not-yet-valid');
    const fine = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    expect(await outcome(lenient.verify, fine)).toBe(`accepted:${IDS.a}`);
  });

  it('N-2 (stated in the changelog): a padded roles string is one role, taken as given', async () => {
    const idp = await fakeIdp();
    const v = jwksIdentity({
      jwksUrl: idp.jwksUri,
      issuer: idp.issuer,
      audience: SHAPE_DEFAULTS.audience,
      userIdClaim: 'oid',
      backend: idp.backend,
    });
    expect(
      await outcome(
        v.verify,
        await idp.sign(personClaims(shapeOf(idp), IDS.a, { roles: ' admin ' })),
      ),
    ).toBe(`accepted:${IDS.a}:[" admin "]`);
  });
});

// ─── S-5, N-4, N-7 ───────────────────────────────────────────────────

describe('S-5 / N-4 / N-7 — the environment', () => {
  it("FIXED: a platform's IDENTITY_ENDPOINT / IDENTITY_HEADER are skipped, and their values never printed", async () => {
    const env = {
      IDENTITY_STRATEGY: 'open',
      IDENTITY_ENDPOINT: 'http://127.0.0.1:41741/MSI/token/',
      IDENTITY_HEADER: '00000000-secret-header-value',
      IDENTITY_SERVER_THUMBPRINT: 'ABCDEF-thumb',
      IDENTITY_API_VERSION: '2019-08-01',
    };
    expect(identityConfigFromEnv(env)).toEqual({ strategy: 'open' });
    const choice = await identityFromConfig(identityConfigFromEnv(env), { production: true });
    expect(choice.banner.join('\n')).not.toMatch(/secret-header-value|MSI|thumb/);
    const err = await bootError(async () => identityConfigFromEnv({ ...env, IDENTITY_TYPO: 'x' }));
    expect(err.message).not.toMatch(/secret-header-value|41741|thumb/);
  });

  it('FIXED: a newline in a value refuses to boot (it would forge a banner line)', async () => {
    const idp = await fakeIdp();
    const err = await bootError(() =>
      identityFromConfig(
        oidcEnv(idp, {
          IDENTITY_AUDIENCE: `${SHAPE_DEFAULTS.audience}\nidentity: person test — all checks on`,
        }),
        { production: true, fetch: idp.fetch, backend: idp.backend },
      ),
    );
    expect(err.key).toBe('IDENTITY_AUDIENCE');
  });

  it('FIXED: a lower-case identity_* key is refused as a likely typo', async () => {
    const err = await bootError(async () =>
      identityConfigFromEnv({ identity_strategy: 'oidc-token' }),
    );
    expect(err.key).toBe('identity_strategy');
    expect(err.message).toMatch(/IDENTITY_STRATEGY/);
  });
});

// ─── S-6 (M20), N-3, N-6 ─────────────────────────────────────────────

describe('S-6 / N-3 / N-6 — order and option validation', () => {
  it('S-6 (M20): the person test runs BEFORE the id claim — an app token with no id claim is not-a-user-token', async () => {
    const idp = await fakeIdp();
    const v = oidcIdentity(options(idp));
    const app = await idp.sign(personClaims(shapeOf(idp), IDS.a, { oid: undefined, idtyp: 'app' }));
    expect(await outcome(v.verify, app)).toBe('refused:not-a-user-token');
  });

  it('FIXED (N-3): discoveryRetryMs / discoveryTimeoutMs are validated', () => {
    const idp = { issuer: 'https://idp.example.test' } as FakeIdp;
    const base = {
      ...SHAPE_DEFAULTS,
      issuer: idp.issuer,
      userIdClaim: 'oid',
      requiredScope: 's',
      allowedClients: ['c'],
    };
    expect(() => oidcIdentity({ ...base, discoveryRetryMs: Number.NaN })).toThrow(
      /discoveryRetryMs/,
    );
    expect(() => oidcIdentity({ ...base, discoveryRetryMs: -1 })).toThrow(/discoveryRetryMs/);
    expect(() => oidcIdentity({ ...base, discoveryTimeoutMs: 0 })).toThrow(/discoveryTimeoutMs/);
    expect(() => oidcIdentity({ ...base, discoveryTimeoutMs: 60_001 })).toThrow(
      /discoveryTimeoutMs/,
    );
  });

  it('FIXED (N-6): HS* and none are refused in oidcIdentity algorithms', () => {
    const base = {
      issuer: 'https://idp.example.test',
      audience: 'a',
      userIdClaim: 'oid',
      requiredScope: 's',
      allowedClients: ['c'],
    };
    expect(() => oidcIdentity({ ...base, algorithms: ['RS256', 'HS256'] })).toThrow(/HS256/);
    expect(() => oidcIdentity({ ...base, algorithms: ['none'] })).toThrow(/algorithm-confusion/);
    expect(() => oidcIdentity({ ...base, algorithms: ['ES256'] })).not.toThrow();
  });
});
