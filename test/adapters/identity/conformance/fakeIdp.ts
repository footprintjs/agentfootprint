/**
 * fakeIdp — an OpenID provider in-process: a signing key, its JWKS, a
 * discovery document, and a token minter with one switch per bad shape.
 *
 * Shared by every identity strategy's tests (rule 22: every strategy passes
 * one conformance suite against fakes before it ships). No socket unless a
 * test asks for one with `listen()` — `fetch` and `backend` serve the same
 * documents from memory, and count what was read so a test can pin "once".
 *
 * What it can NOT stand in for is written in the lab's README: AD FS's second
 * issuer, Entra's app-only tokens and group overage are SHAPES here, copied
 * from Microsoft's documentation, not behaviour observed on those servers.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import * as jose from 'jose';

import type { DiscoveryFetch, JoseBackend } from '../../../../src/identity.js';

/** How the discovery endpoint answers. */
export type DiscoveryMode =
  | 'ok'
  | 'down' // the network call throws
  | 'http-500'
  | 'http-404'
  | 'html'
  | 'no-jwks-uri'
  | 'other-issuer'
  | 'adfs'; // ok, plus an access_token_issuer

export interface FakeIdp {
  readonly issuer: string;
  readonly jwksUri: string;
  /** AD FS's access-token issuer, served only in `'adfs'` mode. */
  readonly accessTokenIssuer: string;
  /** Change how discovery answers from now on. */
  discovery(mode: DiscoveryMode): void;
  /** Discovery reads so far. */
  readonly discoveryReads: number;
  /** Key-set builds so far (`createRemoteJWKSet` calls). */
  readonly keySetBuilds: number;
  /** Serves discovery from memory. */
  readonly fetch: DiscoveryFetch;
  /** `jose`, with the remote key set replaced by this IdP's local one. */
  readonly backend: JoseBackend;
  /**
   * Sign `claims` exactly as given (no defaults added) with the IdP's key,
   * or with a key it does not publish (`key: 'other'`).
   */
  sign(
    claims: Record<string, unknown>,
    options?: { key?: 'idp' | 'other'; kid?: string },
  ): Promise<string>;
  /** An `alg: none` token with these claims. */
  unsigned(claims: Record<string, unknown>): string;
  /** Rotate to a new signing key; the old one leaves the JWKS. */
  rotate(): Promise<void>;
  /** Serve discovery + JWKS over real HTTP on 127.0.0.1. The issuer is then that URL. */
  listen(): Promise<{ issuer: string; close(): Promise<void>; sign: FakeIdp['sign'] }>;
}

const now = (): number => Math.floor(Date.now() / 1000);

export async function fakeIdp(issuer = 'https://idp.example.test/tenant/v2.0'): Promise<FakeIdp> {
  let mode: DiscoveryMode = 'ok';
  let discoveryReads = 0;
  let keySetBuilds = 0;
  let kid = 'k1';
  let pair = await jose.generateKeyPair('RS256', { extractable: true });
  const other = await jose.generateKeyPair('RS256', { extractable: true });
  const jwksUri = `${issuer}/keys`;
  const accessTokenIssuer = 'http://idp.example.test/adfs/services/trust';

  const publicJwks = async (): Promise<{ keys: jose.JWK[] }> => {
    const jwk = await jose.exportJWK(pair.publicKey);
    return { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
  };

  const documentFor = (iss: string, keysUrl: string): Record<string, unknown> => ({
    issuer: mode === 'other-issuer' ? `${iss}/elsewhere` : iss,
    ...(mode !== 'no-jwks-uri' && { jwks_uri: keysUrl }),
    ...(mode === 'adfs' && { access_token_issuer: accessTokenIssuer }),
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
  });

  const answer = (iss: string, keysUrl: string): { status: number; body: string } => {
    discoveryReads += 1;
    if (mode === 'http-500') return { status: 500, body: 'upstream broke' };
    if (mode === 'http-404') return { status: 404, body: 'not found' };
    if (mode === 'html') return { status: 200, body: '<html>sign in</html>' };
    return { status: 200, body: JSON.stringify(documentFor(iss, keysUrl)) };
  };

  const sign = async (
    claims: Record<string, unknown>,
    options: { key?: 'idp' | 'other'; kid?: string } = {},
  ): Promise<string> =>
    new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? kid })
      .sign(options.key === 'other' ? other.privateKey : pair.privateKey);

  const idp: FakeIdp = {
    issuer,
    jwksUri,
    accessTokenIssuer,
    discovery(next) {
      mode = next;
    },
    get discoveryReads() {
      return discoveryReads;
    },
    get keySetBuilds() {
      return keySetBuilds;
    },
    fetch: async (url) => {
      if (mode === 'down') throw new TypeError('fetch failed');
      if (url !== `${issuer}/.well-known/openid-configuration`) {
        return { status: 404, text: async () => 'no such path' };
      }
      const { status, body } = answer(issuer, jwksUri);
      return { status, text: async () => body };
    },
    backend: {
      createRemoteJWKSet: () => {
        keySetBuilds += 1;
        // Resolve the CURRENT key set on every call, so rotation is visible.
        return async (header: jose.JWSHeaderParameters, token: jose.FlattenedJWSInput) =>
          jose.createLocalJWKSet(await publicJwks())(header, token);
      },
      jwtVerify: (token, key, options) =>
        jose.jwtVerify(token, key as Parameters<typeof jose.jwtVerify>[1], options) as Promise<{
          payload: Record<string, unknown>;
        }>,
    },
    sign,
    unsigned: (claims) => new jose.UnsecuredJWT(claims).encode(),
    async rotate() {
      pair = await jose.generateKeyPair('RS256', { extractable: true });
      kid = `${kid}+`;
    },
    async listen() {
      let base = '';
      const server: Server = createServer((req, res) => {
        void (async () => {
          const path = req.url ?? '/';
          if (path === '/realm/.well-known/openid-configuration') {
            const { status, body } = answer(`${base}/realm`, `${base}/realm/keys`);
            res.writeHead(status, { 'content-type': 'application/json' }).end(body);
          } else if (path === '/realm/keys') {
            res
              .writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify(await publicJwks()));
          } else res.writeHead(404).end();
        })();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return {
        issuer: `${base}/realm`,
        sign,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      };
    },
  };
  return idp;
}

// ─── Token shapes ────────────────────────────────────────────────────

/** The defaults a PERSON's access token carries, Entra-v2-shaped. */
export interface PersonShape {
  readonly issuer: string;
  readonly audience: string;
  readonly scope: string;
  readonly client: string;
}

/** A person's access token claims for `userId`, with overrides (a key set to `undefined` is removed). */
export function personClaims(
  shape: PersonShape,
  userId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const claims: Record<string, unknown> = {
    iss: shape.issuer,
    aud: shape.audience,
    iat: now(),
    nbf: now() - 5,
    exp: now() + 3600,
    sub: `pairwise-${userId.length}-${[...userId].reverse().join('')}`,
    oid: userId,
    scp: shape.scope,
    azp: shape.client,
    name: 'Priya Shah',
    ...overrides,
  };
  for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
  return claims;
}

/**
 * An app-only token as Entra issues it to ANY app in the tenant by the
 * client-credentials grant: right issuer, right audience, an `oid` (the
 * service principal, equal to `sub`), app roles, and no `scp`.
 */
export function appOnlyClaims(
  shape: PersonShape,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return personClaims(shape, 'sp-7c1e', {
    sub: 'sp-7c1e',
    scp: undefined,
    azp: 'some-other-app',
    roles: ['Task.Write'],
    ...overrides,
  });
}

export const seconds = { now };
