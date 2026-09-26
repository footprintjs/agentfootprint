/**
 * oidcIdentity — the `oidc-token` verifier. 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned (the identity-strategies design, §4.3):
 *   • Discovery before any token, failures CLASSIFIED: unreachable / 5xx is an
 *     outage (503, retried), a 404 / non-JSON / no jwks_uri / another issuer
 *     is misconfiguration (503 "misconfigured", final).
 *   • `iss` = the configured issuer, or AD FS's `access_token_issuer`.
 *   • `exp` required; clock tolerance 60 s by default.
 *   • THE PERSON TEST: required scope, roles-without-scope, `idtyp: app`,
 *     `oid == sub`, and the obtaining client.
 *   • A roles string is ONE role; a path reads nested roles; an overage
 *     pointer is `roles-unknown`.
 *
 * The conformance battery (identity-conformance.test.ts) covers the
 * per-shape refusals; this file covers what is specific to this verifier.
 */

import { describe, expect, it } from 'vitest';
import * as jose from 'jose';

import { oidcIdentity, type OidcIdentityOptions } from '../../../src/identity.js';
import { IdentityNotVerifiedError, verifyRequestIdentity } from '../../../src/doors/hosting.js';
import {
  claimAt,
  clientOf,
  rolesOf,
  scopesOf,
} from '../../../src/adapters/identity/verify/claims.js';
import { personTestFailure } from '../../../src/adapters/identity/verify/personTest.js';
import { readDiscovery } from '../../../src/adapters/identity/verify/discovery.js';
import {
  appOnlyClaims,
  fakeIdp,
  personClaims,
  seconds,
  type FakeIdp,
} from './conformance/fakeIdp.js';
import { IDS, SHAPE_DEFAULTS } from './conformance/harnesses.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function optionsFor(idp: FakeIdp, extra: Partial<OidcIdentityOptions> = {}): OidcIdentityOptions {
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

const shapeOf = (idp: FakeIdp) => ({ issuer: idp.issuer, ...SHAPE_DEFAULTS });

async function outcome(verify: (t: string) => Promise<unknown>, token: string): Promise<string> {
  try {
    await verify(token);
    return 'accepted';
  } catch (err) {
    return (err as { failure?: string }).failure ?? (err as { code?: string }).code ?? 'other';
  }
}

/** A deterministic pseudo-random stream (no fast-check in this repo). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ─── 1. UNIT — construction, and the claim readers ───────────────────

describe('oidcIdentity — construction refuses what it cannot honour', () => {
  const base = {
    issuer: 'https://idp.example.test',
    audience: 'api://neo',
    userIdClaim: 'oid',
    requiredScope: 'access_as_user',
    allowedClients: ['neo-web'],
  } as OidcIdentityOptions;

  it.each([
    [{ userIdClaim: '' }, /userIdClaim is required/],
    [{ requiredScope: undefined }, /requiredScope is required/],
    [{ requiredScope: 'a b' }, /ONE scope/],
    [{ allowedClients: [] }, /allowedClients is required/],
    [{ allowedClients: undefined }, /allowedClients is required/],
    [{ audience: '' }, /audience is required/],
    [{ issuer: 'http://idp.example.test' }, /plain http/],
    [{ issuer: 'http://127.0.0.1:8080/realm' }, /plain http/],
    [{ issuer: 'not a url' }, /not an absolute URL/],
    [{ discovery: 'off' }, /jwksUrl is required/],
    [{ jwksUrl: 'http://keys.example.test/jwks' }, /plain http/],
    [{ rolesClaim: [] }, /rolesClaim/],
    [{ clockToleranceSeconds: -1 }, /clockToleranceSeconds/],
  ])('refuses %j', (patch, message) => {
    expect(() => oidcIdentity({ ...base, ...patch } as OidcIdentityOptions)).toThrow(message);
  });

  it('accepts plain http on a loopback host only when told to (development)', () => {
    expect(() =>
      oidcIdentity({
        ...base,
        issuer: 'http://127.0.0.1:18480/realms/corp',
        allowLoopbackHttp: true,
      }),
    ).not.toThrow();
    expect(() =>
      oidcIdentity({
        ...base,
        issuer: 'http://idp.corp.example/realms/corp',
        allowLoopbackHttp: true,
      }),
    ).toThrow(/not this machine/);
  });

  it("with discovery off the issuer is a literal (Pomerium's bare domain), never fetched", () => {
    expect(() =>
      oidcIdentity({
        ...base,
        issuer: 'neo.corp.example',
        discovery: 'off',
        jwksUrl: 'https://neo.corp.example/.well-known/pomerium/jwks.json',
      }),
    ).not.toThrow();
  });
});

describe('the claim readers — unit', () => {
  it('a roles STRING is one role; an array is one role per string entry', () => {
    expect(rolesOf('Not neo-users', 'list')).toEqual(['Not neo-users']);
    expect(rolesOf(['a', 'b c', 7, ''], 'list')).toEqual(['a', 'b c']);
    expect(rolesOf('', 'list')).toBeUndefined();
    expect(rolesOf(undefined, 'list')).toBeUndefined();
    expect(rolesOf('read write', 'space-delimited')).toEqual(['read', 'write']);
  });

  it('a scope claim is space-delimited, or an array', () => {
    expect(scopesOf('openid  access_as_user ')).toEqual(['openid', 'access_as_user']);
    expect(scopesOf(['a', 'b'])).toEqual(['a', 'b']);
    expect(scopesOf('   ')).toBeUndefined();
  });

  it('a claim NAME is never split; a PATH walks nested objects', () => {
    const claims = {
      'urn:neo:objectguid': 'g',
      'a.b': 'dotted',
      a: { b: 'nested' },
      realm_access: { roles: ['r'] },
    };
    expect(claimAt(claims, 'urn:neo:objectguid')).toBe('g');
    expect(claimAt(claims, 'a.b')).toBe('dotted');
    expect(claimAt(claims, ['a', 'b'])).toBe('nested');
    expect(claimAt(claims, ['realm_access', 'roles'])).toEqual(['r']);
    expect(claimAt(claims, ['realm_access', 'roles', 'x'])).toBeUndefined();
  });

  it('the obtaining client is the FIRST present of azp, appid, cid, client_id — no fall-through', () => {
    expect(clientOf({ appid: 'adfs-client', client_id: 'x' })).toBe('adfs-client');
    expect(clientOf({ cid: 'okta', client_id: 'x' })).toBe('okta');
    expect(clientOf({ client_id: 'rfc9068' })).toBe('rfc9068');
    // A present-but-wrong azp names nobody; it does not let the token choose
    // which of its claims is read.
    expect(clientOf({ azp: 42, appid: 'neo-web' })).toBeUndefined();
    expect(clientOf({})).toBeUndefined();
  });

  it('the person test checks in order: idtyp, oid==sub, roles-without-scope, scope, client', () => {
    const opts = {
      requiredScope: 's',
      scopeClaim: 'scp',
      allowedClients: ['c'],
      rolesClaim: 'roles',
    } as const;
    const person = { scp: 's', azp: 'c', oid: 'o', sub: 'p' };
    expect(personTestFailure(person, opts)).toBeUndefined();
    expect(personTestFailure({ ...person, idtyp: 'app' }, opts)).toBe('not-a-user-token');
    expect(personTestFailure({ ...person, idtyp: 'user' }, opts)).toBeUndefined();
    expect(personTestFailure({ ...person, sub: 'o' }, opts)).toBe('not-a-user-token');
    expect(personTestFailure({ azp: 'c', roles: ['r'] }, opts)).toBe('not-a-user-token');
    expect(personTestFailure({ ...person, scp: 'other' }, opts)).toBe('not-a-user-token');
    expect(personTestFailure({ ...person, azp: 'd' }, opts)).toBe('wrong-client');
    expect(
      personTestFailure({ ...person, azp: 'd' }, { ...opts, allowedClients: 'any' }),
    ).toBeUndefined();
  });
});

// ─── 2. SCENARIO — the IdP shapes the design names ───────────────────

describe('oidcIdentity — scenarios', () => {
  it('Entra ID: a person verifies as oid; an app-only token from ANY app in the tenant does not', async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const person = await verifier.verify(await idp.sign(personClaims(shapeOf(idp), IDS.a)));
    expect(person.userId).toBe(IDS.a);
    expect(await outcome(verifier.verify, await idp.sign(appOnlyClaims(shapeOf(idp))))).toBe(
      'not-a-user-token',
    );
    // Even an app-only token that a misconfigured tenant stamped with the
    // required scope is refused by its shape.
    const stamped = appOnlyClaims(shapeOf(idp), { scp: 'access_as_user', azp: 'neo-web' });
    expect(await outcome(verifier.verify, await idp.sign(stamped))).toBe('not-a-user-token');
  });

  it('AD FS: access tokens signed with access_token_issuer verify; a URI-named id claim and roles claim are read whole', async () => {
    const idp = await fakeIdp('https://fs.corp.example/adfs');
    idp.discovery('adfs');
    const roleClaim = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';
    const verifier = oidcIdentity(
      optionsFor(idp, {
        userIdClaim: 'urn:neo:objectguid',
        rolesClaim: roleClaim,
        allowedClients: ['5f1c'],
      }),
    );
    const token = await idp.sign(
      personClaims(shapeOf(idp), 'x', {
        iss: idp.accessTokenIssuer,
        azp: undefined,
        appid: '5f1c',
        oid: undefined,
        'urn:neo:objectguid': 'T2Jq+ZkA0UqF3mQn8c1bBg==',
        [roleClaim]: 'Neo Users (Prod)',
      }),
    );
    const who = await verifier.verify(token);
    expect(who.userId).toBe('T2Jq+ZkA0UqF3mQn8c1bBg==');
    expect(who.roles).toEqual(['Neo Users (Prod)']);
    // The discovery issuer is accepted too.
    const direct = await idp.sign(
      personClaims(shapeOf(idp), 'y', { 'urn:neo:objectguid': 'g2', azp: '5f1c' }),
    );
    expect((await verifier.verify(direct)).userId).toBe('g2');
  });

  it("AD FS's access-token issuer is NOT accepted when the document does not name it", async () => {
    const idp = await fakeIdp('https://fs.corp.example/adfs');
    const verifier = oidcIdentity(optionsFor(idp));
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a, { iss: idp.accessTokenIssuer }));
    expect(await outcome(verifier.verify, token)).toBe('wrong-issuer');
  });

  it('Keycloak: scope in `scope`, realm roles at a PATH, the client in azp', async () => {
    const idp = await fakeIdp('https://kc.corp.example/realms/corp');
    const verifier = oidcIdentity(
      optionsFor(idp, {
        userIdClaim: 'objectguid',
        scopeClaim: 'scope',
        rolesClaim: ['realm_access', 'roles'],
        requiredScope: 'neo-api',
      }),
    );
    const token = await idp.sign(
      personClaims(shapeOf(idp), 'x', {
        oid: undefined,
        scp: undefined,
        scope: 'openid profile email neo-api',
        objectguid: '9948164f-65f0-4ac0-8bb0-4a3d1103fcd7',
        realm_access: { roles: ['SAN-Ops', 'offline_access'] },
      }),
    );
    const who = await verifier.verify(token);
    expect(who.userId).toBe('9948164f-65f0-4ac0-8bb0-4a3d1103fcd7');
    expect(who.roles).toEqual(['SAN-Ops', 'offline_access']);
  });

  it("Entra group overage: roles from `groups` replaced by a pointer are roles-unknown, never 'none'", async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp, { rolesClaim: 'groups' }));
    const overage = await idp.sign(
      personClaims(shapeOf(idp), IDS.a, {
        _claim_names: { groups: 'src1' },
        _claim_sources: { src1: { endpoint: 'https://graph.windows.net/x/getMemberObjects' } },
      }),
    );
    expect(await outcome(verifier.verify, overage)).toBe('roles-unknown');
    const implicit = await idp.sign(personClaims(shapeOf(idp), IDS.a, { hasgroups: true }));
    expect(await outcome(verifier.verify, implicit)).toBe('roles-unknown');
    const plain = await idp.sign(personClaims(shapeOf(idp), IDS.a, { groups: ['g1'] }));
    expect((await verifier.verify(plain)).roles).toEqual(['g1']);
  });

  it('discovery down → 503; the IdP comes back → accepted after a retry', async () => {
    const idp = await fakeIdp();
    idp.discovery('down');
    const verifier = oidcIdentity(optionsFor(idp, { discoveryRetryMs: 0 }));
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    expect(await outcome(verifier.verify, token)).toBe('ERR_IDENTITY_VERIFIER_UNAVAILABLE');
    idp.discovery('http-500');
    expect(await outcome(verifier.verify, token)).toBe('ERR_IDENTITY_VERIFIER_UNAVAILABLE');
    idp.discovery('ok');
    expect((await verifier.verify(token)).userId).toBe(IDS.a);
  });

  it.each([
    ['http-404', /answered HTTP 404/],
    ['html', /did not answer JSON/],
    ['no-jwks-uri', /names no 'jwks_uri'/],
    ['other-issuer', /names the issuer/],
  ] as const)(
    'discovery %s is MISCONFIGURED: final, and every request answers 503 naming it',
    async (mode, check) => {
      const idp = await fakeIdp();
      idp.discovery(mode);
      const verifier = oidcIdentity(optionsFor(idp, { discoveryRetryMs: 0 }));
      const state = await verifier.discover();
      expect(state.kind).toBe('misconfigured');
      expect(state.kind === 'misconfigured' && state.check).toMatch(check);
      idp.discovery('ok');
      const token = await idp.sign(personClaims(shapeOf(idp), IDS.a));
      await expect(verifier.verify(token)).rejects.toThrow(/identity is misconfigured/);
      expect(idp.discoveryReads).toBe(1);
    },
  );

  it('after an outage boot, a misconfigured answer is reported but NOT final (review S-1): a maintenance page does not brick sign-in', async () => {
    const idp = await fakeIdp();
    idp.discovery('down');
    const log: string[] = [];
    const verifier = oidcIdentity(
      optionsFor(idp, { discoveryRetryMs: 0, log: (line) => log.push(line) }),
    );
    expect((await verifier.discover()).kind).toBe('outage');
    idp.discovery('html'); // the load balancer's maintenance page, once
    expect((await verifier.discover()).kind).toBe('misconfigured');
    expect((await verifier.discover()).kind).toBe('misconfigured'); // unchanged: logged once
    idp.discovery('ok');
    expect((await verifier.discover()).kind).toBe('ready');
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    expect((await verifier.verify(token)).userId).toBe(IDS.a);
    // One line per CHANGE of state (the boot's own first answer is the banner's).
    expect(log).toHaveLength(2);
    expect(log[0]).toMatch(/discovery misconfigured: .* did not answer JSON/);
    expect(log[1]).toMatch(/discovery ok/);
  });

  it('a misconfigured FIRST answer is final (the boot refuses it)', async () => {
    const idp = await fakeIdp();
    idp.discovery('http-404');
    const verifier = oidcIdentity(optionsFor(idp, { discoveryRetryMs: 0 }));
    expect((await verifier.discover()).kind).toBe('misconfigured');
    idp.discovery('ok');
    expect((await verifier.discover()).kind).toBe('misconfigured');
  });

  it('key rotation mid-run: tokens signed by the new key verify, the old key is gone', async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const before = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    expect((await verifier.verify(before)).userId).toBe(IDS.a);
    await idp.rotate();
    const after = await idp.sign(personClaims(shapeOf(idp), IDS.b));
    expect((await verifier.verify(after)).userId).toBe(IDS.b);
    expect(await outcome(verifier.verify, before)).toBe('unverifiable');
  });

  it('clock tolerance is 60 s by default, and configurable', async () => {
    const idp = await fakeIdp();
    const t = seconds.now();
    const lately = await idp.sign(personClaims(shapeOf(idp), IDS.a, { exp: t - 30, iat: t - 600 }));
    const tooLate = await idp.sign(
      personClaims(shapeOf(idp), IDS.a, { exp: t - 90, iat: t - 600 }),
    );
    expect((await oidcIdentity(optionsFor(idp)).verify(lately)).userId).toBe(IDS.a);
    expect(await outcome(oidcIdentity(optionsFor(idp)).verify, tooLate)).toBe('expired');
    expect(
      await outcome(oidcIdentity(optionsFor(idp, { clockToleranceSeconds: 0 })).verify, lately),
    ).toBe('expired');
  });

  it("the caller's bearer runs through the ONE funnel and becomes the proven id", async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a));
    const who = await verifyRequestIdentity(
      { verify: verifier.verify },
      { authorization: `Bearer ${token}` },
      IDS.a,
    );
    expect(who?.userId).toBe(IDS.a);
    const app = await idp.sign(appOnlyClaims(shapeOf(idp)));
    await expect(
      verifyRequestIdentity(
        { verify: verifier.verify },
        { authorization: `Bearer ${app}` },
        undefined,
      ),
    ).rejects.toMatchObject({ failure: 'not-a-user-token' });
  });
});

// ─── 3. INTEGRATION — real HTTP, real fetch, real jose key fetching ──

describe('oidcIdentity — integration over a socket', () => {
  it('reads discovery and the JWKS over HTTP and verifies a person', async () => {
    const idp = await fakeIdp();
    const served = await idp.listen();
    try {
      const verifier = oidcIdentity({
        issuer: served.issuer,
        audience: SHAPE_DEFAULTS.audience,
        userIdClaim: 'oid',
        requiredScope: SHAPE_DEFAULTS.scope,
        allowedClients: [SHAPE_DEFAULTS.client],
        allowLoopbackHttp: true,
      });
      const token = await served.sign(
        personClaims({ issuer: served.issuer, ...SHAPE_DEFAULTS }, IDS.a),
      );
      expect((await verifier.verify(token)).userId).toBe(IDS.a);
      expect(await verifier.discover()).toMatchObject({
        kind: 'ready',
        issuer: { issuer: served.issuer, jwksUri: `${served.issuer}/keys` },
      });
    } finally {
      await served.close();
    }
  });

  it('a closed port is an OUTAGE, not a config error', async () => {
    const idp = await fakeIdp();
    const served = await idp.listen();
    await served.close();
    const outcomeOf = await readDiscovery(served.issuer, {
      fetch: (url, init) => fetch(url, init),
      timeoutMs: 2000,
      allowLoopbackHttp: true,
    });
    expect(outcomeOf.kind).toBe('outage');
  });
});

// ─── 4. PROPERTY — what no input can do ──────────────────────────────

describe('oidcIdentity — properties', () => {
  it('no roles string containing a space ever yields a role without that space', () => {
    const next = lcg(9);
    const alphabet = 'ab -_Neo users\t';
    for (let i = 0; i < 500; i += 1) {
      let s = '';
      const len = 1 + Math.floor(next() * 20);
      for (let j = 0; j < len; j += 1) s += alphabet[Math.floor(next() * alphabet.length)];
      const roles = rolesOf(s, 'list');
      if (s.trim().length === 0) expect(roles).toBeUndefined();
      else expect(roles).toEqual([s]);
    }
  });

  it('whatever else a token carries, without the required scope it is never a person', () => {
    const next = lcg(21);
    const scopes = [
      'openid',
      'profile',
      'User.Read',
      'access_as_user2',
      'ACCESS_AS_USER',
      'access_as_use',
    ];
    for (let i = 0; i < 300; i += 1) {
      const picked = scopes.filter(() => next() < 0.5);
      const claims = {
        scp: next() < 0.5 ? picked.join(' ') : picked,
        azp: 'neo-web',
        oid: `o${i}`,
        sub: `s${i}`,
        ...(next() < 0.3 && { roles: ['x'] }),
      };
      expect(
        personTestFailure(claims, {
          requiredScope: 'access_as_user',
          scopeClaim: 'scp',
          allowedClients: ['neo-web'],
          rolesClaim: 'roles',
        }),
      ).toBe('not-a-user-token');
    }
  });

  it('any id bytes round-trip unchanged', async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const next = lcg(33);
    for (let i = 0; i < 25; i += 1) {
      let id = '';
      const len = 1 + Math.floor(next() * 24);
      for (let j = 0; j < len; j += 1) id += String.fromCharCode(32 + Math.floor(next() * 400));
      const token = await idp.sign(personClaims(shapeOf(idp), id));
      expect((await verifier.verify(token)).userId).toBe(id);
    }
  });
});

// ─── 5. SECURITY — algorithm confusion, and nothing leaks ────────────

describe('oidcIdentity — security', () => {
  it('HS256 signed with the PUBLIC key is refused (algorithm confusion)', async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const published = (await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey)).n!;
    const forged = await new jose.SignJWT(personClaims(shapeOf(idp), IDS.a))
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .sign(new TextEncoder().encode(published));
    expect(await outcome(verifier.verify, forged)).toBe('unverifiable');
  });

  it("an unknown kid is unverifiable, and a refusal never quotes the discovery document's text", async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const token = await idp.sign(personClaims(shapeOf(idp), IDS.a), { kid: 'nope', key: 'other' });
    expect(await outcome(verifier.verify, token)).toBe('unverifiable');

    const down = await fakeIdp();
    down.discovery('http-500');
    const err = await oidcIdentity(optionsFor(down))
      .verify(token)
      .catch((e: Error) => e);
    expect(String(err)).not.toContain('upstream broke');
    expect(String(err)).not.toContain(token);
  });

  it('refusals are the typed class with no cause attached', async () => {
    const idp = await fakeIdp();
    const err = await oidcIdentity(optionsFor(idp))
      .verify(await idp.sign(appOnlyClaims(shapeOf(idp))))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IdentityNotVerifiedError);
    expect((err as Error).cause).toBeUndefined();
  });
});

// ─── 6. PERFORMANCE — discovery once, keys once, single-flight ───────

describe('oidcIdentity — performance', () => {
  it('reads discovery ONCE and builds the key set ONCE across many concurrent verifications', async () => {
    const idp = await fakeIdp();
    const verifier = oidcIdentity(optionsFor(idp));
    const tokens = await Promise.all(
      Array.from({ length: 20 }, (_, i) => idp.sign(personClaims(shapeOf(idp), `user-${i}`))),
    );
    const ids = await Promise.all(tokens.map(async (t) => (await verifier.verify(t)).userId));
    expect(new Set(ids).size).toBe(20);
    expect(idp.discoveryReads).toBe(1);
    expect(idp.keySetBuilds).toBe(1);
  });

  it('during an outage, requests inside the retry gap do not re-read discovery', async () => {
    const idp = await fakeIdp();
    idp.discovery('http-500');
    const verifier = oidcIdentity(optionsFor(idp, { discoveryRetryMs: 60_000 }));
    for (let i = 0; i < 5; i += 1) expect((await verifier.discover()).kind).toBe('outage');
    expect(idp.discoveryReads).toBe(1);
  });
});

// ─── 7. ROI — one verifier, three IdPs, only config differs ──────────

describe('oidcIdentity — ROI', () => {
  it('Entra, AD FS and Keycloak differ only in five config values', async () => {
    const configs: Partial<OidcIdentityOptions>[] = [
      { userIdClaim: 'oid' },
      {
        userIdClaim: 'urn:neo:objectguid',
        rolesClaim: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
      },
      { userIdClaim: 'objectguid', scopeClaim: 'scope', rolesClaim: ['realm_access', 'roles'] },
    ];
    for (const extra of configs) {
      const idp = await fakeIdp();
      const verifier = oidcIdentity(optionsFor(idp, extra));
      const token = await idp.sign(
        personClaims(shapeOf(idp), IDS.a, {
          'urn:neo:objectguid': IDS.a,
          objectguid: IDS.a,
          scope: SHAPE_DEFAULTS.scope,
        }),
      );
      expect((await verifier.verify(token)).userId).toBe(IDS.a);
    }
  });
});
