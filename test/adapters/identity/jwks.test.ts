/**
 * jwksIdentity + the `jose` PIN — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * ── Why a PIN test, and what it pins ────────────────────────────────────────
 * This adapter maps `jose`'s failures onto this library's failure vocabulary by
 * ERROR CODE STRING. That mapping is a claim about somebody else's library, and
 * a claim about somebody else's library that nothing checks is a claim that
 * rots silently: the day `jose` renames a code, every expired token starts
 * reporting `unverifiable`, every client is told to re-authenticate instead of
 * refresh, and no test goes red.
 *
 * So the first block below asserts the codes AGAINST THE REAL INSTALLED
 * PACKAGE — sign a token, break it in one specific way, and check what the
 * library actually raises. It skips itself (rather than failing) where `jose`
 * is not installed, because it is an optional peer.
 *
 * The pinned facts, as observed on jose 6.2.7:
 *   expired            → ERR_JWT_EXPIRED
 *   wrong audience     → ERR_JWT_CLAIM_VALIDATION_FAILED, claim 'aud'
 *   wrong issuer       → ERR_JWT_CLAIM_VALIDATION_FAILED, claim 'iss'
 *   not yet valid      → ERR_JWT_CLAIM_VALIDATION_FAILED, claim 'nbf'
 *   forged signature   → ERR_JWS_SIGNATURE_VERIFICATION_FAILED
 *   unknown kid        → ERR_JWKS_NO_MATCHING_KEY
 *   alg: none          → refused (a JWKS resolver has no key for it)
 *   disallowed alg     → ERR_JOSE_ALG_NOT_ALLOWED
 */

import { describe, expect, it } from 'vitest';

import { jwksIdentity } from '../../../src/identity.js';
import type { JoseBackend } from '../../../src/adapters/identity/jwks.js';

// ─── Load the real library, or skip ──────────────────────────────────

interface JoseTestApi extends JoseBackend {
  generateKeyPair(
    alg: string,
    options?: { extractable?: boolean },
  ): Promise<{
    publicKey: unknown;
    privateKey: unknown;
  }>;
  exportJWK(key: unknown): Promise<Record<string, unknown>>;
  createLocalJWKSet(jwks: { keys: Record<string, unknown>[] }): unknown;
  SignJWT: new (payload: Record<string, unknown>) => {
    setProtectedHeader(h: Record<string, unknown>): unknown;
    setIssuer(i: string): unknown;
    setAudience(a: string): unknown;
    setSubject(s: string): unknown;
    setNotBefore(n: string): unknown;
    setExpirationTime(e: string): unknown;
    sign(key: unknown): Promise<string>;
  };
  UnsecuredJWT: new (payload: Record<string, unknown>) => {
    setIssuer(i: string): unknown;
    setAudience(a: string): unknown;
    encode(): string;
  };
  jwtVerify(
    token: string,
    key: unknown,
    options?: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown> }>;
}

let jose: JoseTestApi | undefined;
try {
  jose = (await import('jose')) as unknown as JoseTestApi;
} catch {
  jose = undefined;
}

const ISSUER = 'https://idp.example.test/';
const AUDIENCE = 'my-api';

/** A signing key, its JWKS, and a token factory — built once per describe. */
async function keyring(): Promise<{
  keys: unknown;
  sign(claims: Record<string, unknown>, over?: Record<string, string>): Promise<string>;
  otherKey: unknown;
  jwk: Record<string, unknown>;
}> {
  const api = jose as JoseTestApi;
  const pair = await api.generateKeyPair('RS256', { extractable: true });
  const jwk = await api.exportJWK(pair.publicKey);
  jwk.kid = 'k1';
  jwk.alg = 'RS256';
  const keys = api.createLocalJWKSet({ keys: [jwk] });
  const other = await api.generateKeyPair('RS256', { extractable: true });
  return {
    keys,
    jwk,
    otherKey: other.privateKey,
    sign(claims, over = {}) {
      const builder = new api.SignJWT(claims) as unknown as Record<
        string,
        (v: unknown) => unknown
      > & { sign(k: unknown): Promise<string> };
      let b = builder.setProtectedHeader({
        alg: over.alg ?? 'RS256',
        kid: over.kid ?? 'k1',
      }) as typeof builder;
      b = b.setIssuer(over.iss ?? ISSUER) as typeof builder;
      b = b.setAudience(over.aud ?? AUDIENCE) as typeof builder;
      b = b.setSubject(over.sub ?? 'user-42') as typeof builder;
      if (over.nbf !== undefined) b = b.setNotBefore(over.nbf) as typeof builder;
      b = b.setExpirationTime(over.exp ?? '2h') as typeof builder;
      return b.sign(over.key === 'other' ? other.privateKey : pair.privateKey);
    },
  };
}

/** A backend that serves a LOCAL key set instead of fetching one — the whole
 *  adapter, minus the network, which is the only part a unit test must not
 *  depend on. */
function localBackend(keys: unknown): JoseBackend {
  const api = jose as JoseTestApi;
  return {
    createRemoteJWKSet: () => keys,
    jwtVerify: (token, key, options) => api.jwtVerify(token, key, options),
  };
}

const describeJose = jose === undefined ? describe.skip : describe;

// ─── 1. THE PIN — assertions about the REAL library ──────────────────

describeJose('jose 6 — SDK pin (asserted against the installed package)', () => {
  it('raises the exact error codes this adapter maps by', async () => {
    const api = jose as JoseTestApi;
    const ring = await keyring();
    const good = await ring.sign({ roles: ['admin'] });

    // The happy path first — a claim about failure codes is worth nothing if
    // the success path is not the shape we think it is.
    const ok = await api.jwtVerify(good, ring.keys, { issuer: ISSUER, audience: AUDIENCE });
    expect(ok.payload.sub).toBe('user-42');
    expect(ok.payload.roles).toEqual(['admin']);

    const codeOf = async (
      token: string,
      options: Record<string, unknown>,
    ): Promise<{ code?: string; claim?: string }> => {
      try {
        await api.jwtVerify(token, ring.keys, { issuer: ISSUER, audience: AUDIENCE, ...options });
        return {};
      } catch (err) {
        const e = err as { code?: string; claim?: string };
        return { code: e.code, claim: e.claim };
      }
    };

    expect(await codeOf(await ring.sign({}, { exp: '-1h' }), {})).toMatchObject({
      code: 'ERR_JWT_EXPIRED',
    });
    expect(await codeOf(good, { audience: 'someone-else' })).toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
    });
    expect(await codeOf(good, { issuer: 'https://elsewhere/' })).toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'iss',
    });
    expect(await codeOf(await ring.sign({}, { nbf: '2h', exp: '4h' }), {})).toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'nbf',
    });
    expect(await codeOf(await ring.sign({}, { key: 'other' }), {})).toMatchObject({
      code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
    expect(await codeOf(await ring.sign({}, { kid: 'nope', key: 'other' }), {})).toMatchObject({
      code: 'ERR_JWKS_NO_MATCHING_KEY',
    });
    expect(await codeOf(good, { algorithms: ['ES256'] })).toMatchObject({
      code: 'ERR_JOSE_ALG_NOT_ALLOWED',
    });
    expect(await codeOf('not-a-jwt-at-all', {})).toMatchObject({ code: 'ERR_JWS_INVALID' });
  });

  it('SECURITY PIN: an alg:none token cannot be verified against a key set', async () => {
    const api = jose as JoseTestApi;
    const ring = await keyring();
    const unsecured = new api.UnsecuredJWT({ sub: 'mallory' }) as unknown as {
      setIssuer(i: string): { setAudience(a: string): { encode(): string } };
    };
    const token = unsecured.setIssuer(ISSUER).setAudience(AUDIENCE).encode();
    await expect(
      api.jwtVerify(token, ring.keys, { issuer: ISSUER, audience: AUDIENCE }),
    ).rejects.toBeInstanceOf(Error);
  });
});

// ─── 2. UNIT — construction refuses what it cannot honour ────────────

describe('jwksIdentity — construction', () => {
  it('refuses a missing or relative jwksUrl', () => {
    expect(() => jwksIdentity({ jwksUrl: '', issuer: 'i', audience: 'a' })).toThrow(
      /needs the URL your/,
    );
    expect(() => jwksIdentity({ jwksUrl: '/keys.json', issuer: 'i', audience: 'a' })).toThrow(
      /not an absolute URL/,
    );
  });

  it('refuses a verifier with no issuer or no audience', () => {
    // Both refusals name the vulnerability rather than the rule.
    expect(() => jwksIdentity({ jwksUrl: 'https://x/keys', issuer: '', audience: 'a' })).toThrow(
      /accept a token minted by anybody/,
    );
    expect(() => jwksIdentity({ jwksUrl: 'https://x/keys', issuer: 'i', audience: '' })).toThrow(
      /confused-deputy/,
    );
  });
});

// ─── 3. INTEGRATION — the adapter over the real library ──────────────

describeJose('jwksIdentity — integration over the real jose', () => {
  it('verifies a good token and returns userId, roles and claims', async () => {
    const ring = await keyring();
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/.well-known/jwks.json',
      issuer: ISSUER,
      audience: AUDIENCE,
      backend: localBackend(ring.keys),
    });
    const identity = await verifier.verify(await ring.sign({ roles: ['admin', 'ops'] }));
    expect(identity.userId).toBe('user-42');
    expect(identity.roles).toEqual(['admin', 'ops']);
    expect(identity.claims?.iss).toBe(ISSUER);
  });

  it('maps every failure onto the right CLASS', async () => {
    const ring = await keyring();
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/.well-known/jwks.json',
      issuer: ISSUER,
      audience: AUDIENCE,
      backend: localBackend(ring.keys),
    });
    const classOf = async (token: string): Promise<string> => {
      try {
        await verifier.verify(token);
        return 'accepted';
      } catch (err) {
        return (err as { failure?: string; code?: string }).failure ?? String((err as Error).name);
      }
    };
    expect(await classOf(await ring.sign({}, { exp: '-1h' }))).toBe('expired');
    expect(await classOf(await ring.sign({}, { aud: 'other-api' }))).toBe('wrong-audience');
    expect(await classOf(await ring.sign({}, { iss: 'https://elsewhere/' }))).toBe('wrong-issuer');
    expect(await classOf(await ring.sign({}, { nbf: '2h', exp: '4h' }))).toBe('not-yet-valid');
    expect(await classOf(await ring.sign({}, { key: 'other' }))).toBe('unverifiable');
    expect(await classOf('garbage')).toBe('unverifiable');
  });

  it('reads roles from a space-delimited claim and omits them when absent', async () => {
    const ring = await keyring();
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/keys',
      issuer: ISSUER,
      audience: AUDIENCE,
      rolesClaim: 'scope',
      backend: localBackend(ring.keys),
    });
    const withScope = await verifier.verify(await ring.sign({ scope: 'read:all write:own' }));
    expect(withScope.roles).toEqual(['read:all', 'write:own']);
    const without = await verifier.verify(await ring.sign({}));
    expect(without.roles).toBeUndefined();
  });

  it('refuses a valid token that does not name its subject', async () => {
    const ring = await keyring();
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/keys',
      issuer: ISSUER,
      audience: AUDIENCE,
      userIdClaim: 'oid',
      backend: localBackend(ring.keys),
    });
    await expect(verifier.verify(await ring.sign({}))).rejects.toMatchObject({
      failure: 'unverifiable',
    });
  });
});

// ─── 4. SECURITY — nothing about the token comes back ────────────────

describeJose('jwksIdentity — security', () => {
  it('THE TOKEN NEVER APPEARS in a refusal, and no cause carries it', async () => {
    const ring = await keyring();
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/keys',
      issuer: ISSUER,
      audience: AUDIENCE,
      backend: localBackend(ring.keys),
    });
    const token = await ring.sign({}, { exp: '-1h' });
    try {
      await verifier.verify(token);
      throw new Error('should have refused');
    } catch (err) {
      const text = JSON.stringify({
        message: (err as Error).message,
        // A cause would travel into every serializer that walks own
        // properties — this asserts there is none to travel.
        cause: (err as { cause?: unknown }).cause,
        own: Object.getOwnPropertyNames(err as object).map((k) =>
          String((err as unknown as Record<string, unknown>)[k]),
        ),
      });
      expect(text).not.toContain(token);
      expect(text).not.toContain(token.slice(0, 16));
    }
  });

  it('a symmetric algorithm is not in the default accept list', async () => {
    // With a JWKS the key is PUBLIC; accepting an HMAC alg over a published
    // key is the classic algorithm-confusion forgery.
    const ring = await keyring();
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/keys',
      issuer: ISSUER,
      audience: AUDIENCE,
      backend: {
        createRemoteJWKSet: () => ring.keys,
        jwtVerify: (_t, _k, options) => {
          expect(options?.algorithms).not.toContain('HS256');
          expect(options?.algorithms).toContain('RS256');
          return Promise.resolve({ payload: { sub: 'x' } });
        },
      },
    });
    await verifier.verify('anything');
  });

  it('a key set that cannot be fetched is 503-shaped, not 401-shaped', async () => {
    // Telling every client to re-authenticate against a provider that is
    // already down is the wrong instruction at the worst moment.
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/keys',
      issuer: ISSUER,
      audience: AUDIENCE,
      backend: {
        createRemoteJWKSet: () => ({}),
        jwtVerify: () => Promise.reject(new TypeError('fetch failed')),
      },
    });
    await expect(verifier.verify('t')).rejects.toMatchObject({
      code: 'ERR_IDENTITY_VERIFIER_UNAVAILABLE',
    });
  });
});

// ─── 5. PERFORMANCE — the key set is built once ──────────────────────

describe('jwksIdentity — performance', () => {
  it('builds the resolver once and reuses it across verifications', async () => {
    let built = 0;
    const verifier = jwksIdentity({
      jwksUrl: 'https://idp.example.test/keys',
      issuer: ISSUER,
      audience: AUDIENCE,
      backend: {
        createRemoteJWKSet: () => {
          built += 1;
          return {};
        },
        jwtVerify: () => Promise.resolve({ payload: { sub: 'alice' } }),
      },
    });
    await verifier.verify('a');
    await verifier.verify('b');
    await verifier.verify('c');
    expect(built).toBe(1);
  });
});

// ─── 6. ROI — one adapter, cloud and on-prem ─────────────────────────

describe('jwksIdentity — ROI', () => {
  it('is configured with three strings, and nothing about the IdP vendor', () => {
    // The whole point of JWKS: the same three facts describe a cloud IdP and
    // an on-prem one, so there is no second adapter to write.
    const verifier = jwksIdentity({
      jwksUrl: 'https://keycloak.internal/realms/main/protocol/openid-connect/certs',
      issuer: 'https://keycloak.internal/realms/main',
      audience: 'agent-api',
      backend: {
        createRemoteJWKSet: () => ({}),
        jwtVerify: () => Promise.resolve({ payload: { sub: 'alice' } }),
      },
    });
    expect(typeof verifier.verify).toBe('function');
  });
});
