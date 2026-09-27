/**
 * fakeBrowserIdp — an OpenID provider with BROWSER endpoints, over real HTTP:
 * discovery, JWKS, an authorization page (an HTML form a person — or
 * Playwright, or a test's fetch — submits), a token endpoint that checks the
 * client's credential, the redirect URI, the single-use code and PKCE, and an
 * end-session endpoint.
 *
 * One switch per bad behaviour, so a test can make the IdP misbehave in
 * exactly one way.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import * as jose from 'jose';

export interface BrowserIdpUser {
  readonly oid: string;
  readonly name: string;
}

export interface BrowserIdpSwitches {
  /** Leave the ID token out of the token response. */
  omitIdToken?: boolean;
  /** Put this nonce in the ID token instead of the one asked for. */
  wrongNonce?: boolean;
  /** Overrides merged into the ACCESS token's claims (a key set to undefined is removed). */
  accessTokenClaims?: Record<string, unknown>;
  /** Answer the authorization with `?error=` (and an attacker-chosen description). */
  authorizeError?: boolean;
  /** Refuse a token request that carries no PKCE verifier. Default true. */
  requirePkce?: boolean;
  /** Overrides merged into the discovery document (a key set to undefined is removed). */
  discovery?: Record<string, unknown>;
  /** Put RFC 9207 `iss` on the authorization response (a real IdP that advertises it does). */
  issOnCallback?: boolean;
}

export interface FakeBrowserIdp {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** PEM of the client's private key (private_key_jwt). */
  readonly clientKeyPem: string;
  readonly audience: string;
  readonly scope: string;
  readonly users: Readonly<Record<string, BrowserIdpUser>>;
  switches: BrowserIdpSwitches;
  /** What the authorization endpoint last received. */
  readonly lastAuthorize: URLSearchParams | undefined;
  /** How the client authenticated at the token endpoint, last time. */
  readonly lastClientAuth: 'secret' | 'private-key' | 'none' | undefined;
  /** Mint a bearer access token for a user, as a script would get one. */
  accessTokenFor(user: string, overrides?: Record<string, unknown>): Promise<string>;
  /** Register another redirect URI. */
  allowRedirect(uri: string): void;
  close(): Promise<void>;
}

const now = (): number => Math.floor(Date.now() / 1000);

export async function fakeBrowserIdp(
  options: { host?: string; users?: Record<string, BrowserIdpUser> } = {},
): Promise<FakeBrowserIdp> {
  const host = options.host ?? 'localhost';
  const signing = await jose.generateKeyPair('RS256', { extractable: true });
  const client = await jose.generateKeyPair('RS256', { extractable: true });
  const clientKeyPem = await jose.exportPKCS8(client.privateKey);
  const kid = 'idp-1';
  const clientId = 'neo-web';
  const clientSecret = randomBytes(18).toString('base64url');
  const audience = 'api://neo';
  const scope = 'access_as_user';
  const users = options.users ?? {
    alice: { oid: '0a11ce00-0000-4000-8000-00000000a11c', name: 'Alice Archer' },
    bob: { oid: '0b0b0000-0000-4000-8000-000000000b0b', name: 'Bob Baker' },
  };
  const redirects = new Set<string>();
  const codes = new Map<
    string,
    { user: string; nonce: string; redirectUri: string; challenge?: string }
  >();
  let lastAuthorize: URLSearchParams | undefined;
  let lastClientAuth: FakeBrowserIdp['lastClientAuth'];
  let base = '';

  const sign = (claims: Record<string, unknown>): Promise<string> =>
    new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid }).sign(signing.privateKey);

  const accessClaims = (user: BrowserIdpUser, extra: Record<string, unknown> = {}) => {
    const claims: Record<string, unknown> = {
      iss: `${base}/realm`,
      aud: audience,
      azp: clientId,
      scp: scope,
      oid: user.oid,
      sub: `pairwise-${user.oid.slice(0, 8)}`,
      name: user.name,
      iat: now(),
      exp: now() + 300,
      ...extra,
    };
    for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
    return claims;
  };

  const idp: FakeBrowserIdp = {
    get issuer() {
      return `${base}/realm`;
    },
    clientId,
    clientSecret,
    clientKeyPem,
    audience,
    scope,
    users,
    switches: {},
    get lastAuthorize() {
      return lastAuthorize;
    },
    get lastClientAuth() {
      return lastClientAuth;
    },
    accessTokenFor: (name, overrides = {}) =>
      sign(accessClaims(users[name] as BrowserIdpUser, overrides)),
    allowRedirect: (uri) => redirects.add(uri),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      const send = (status: number, body: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      if (url.pathname === '/realm/.well-known/openid-configuration') {
        const doc: Record<string, unknown> = {
          issuer: `${base}/realm`,
          jwks_uri: `${base}/realm/keys`,
          authorization_endpoint: `${base}/realm/authorize`,
          token_endpoint: `${base}/realm/token`,
          end_session_endpoint: `${base}/realm/logout`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          ...idp.switches.discovery,
        };
        for (const [k, v] of Object.entries(doc)) if (v === undefined) delete doc[k];
        return send(200, doc);
      }
      if (url.pathname === '/realm/keys') {
        const jwk = await jose.exportJWK(signing.publicKey);
        return send(200, { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });
      }
      if (url.pathname === '/realm/authorize') {
        lastAuthorize = url.searchParams;
        const q = url.searchParams;
        if (q.get('client_id') !== clientId || !redirects.has(q.get('redirect_uri') ?? '')) {
          return send(400, 'unknown client or redirect_uri', 'text/plain');
        }
        if (idp.switches.authorizeError === true) {
          const back = new URL(q.get('redirect_uri') as string);
          back.searchParams.set('error', 'access_denied');
          back.searchParams.set('error_description', '<script>alert(1)</script> IdP words');
          back.searchParams.set('state', q.get('state') ?? '');
          res.writeHead(302, { location: back.href }).end();
          return;
        }
        const hidden = ['redirect_uri', 'state', 'nonce', 'code_challenge']
          .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(q.get(k) ?? '')}">`)
          .join('');
        return send(
          200,
          `<!doctype html><form id="login" method="post" action="/realm/login">${hidden}` +
            `<input name="user" id="user"><button id="go" type="submit">Sign in</button></form>`,
          'text/html',
        );
      }
      if (url.pathname === '/realm/login' && req.method === 'POST') {
        const form = new URLSearchParams(await bodyOf(req));
        const user = form.get('user') ?? '';
        if (users[user] === undefined) return send(401, 'no such user', 'text/plain');
        const code = randomBytes(18).toString('base64url');
        const challenge = form.get('code_challenge') ?? '';
        codes.set(code, {
          user,
          nonce: form.get('nonce') ?? '',
          redirectUri: form.get('redirect_uri') ?? '',
          ...(challenge.length > 0 && { challenge }),
        });
        const back = new URL(form.get('redirect_uri') ?? '');
        back.searchParams.set('code', code);
        back.searchParams.set('state', form.get('state') ?? '');
        if (idp.switches.issOnCallback === true) back.searchParams.set('iss', `${base}/realm`);
        res.writeHead(302, { location: back.href }).end();
        return;
      }
      if (url.pathname === '/realm/token' && req.method === 'POST') {
        const form = new URLSearchParams(await bodyOf(req));
        const authed = await clientAuthenticated(req, form);
        if (authed === 'none') return send(401, { error: 'invalid_client' });
        lastClientAuth = authed;
        const code = form.get('code') ?? '';
        const grant = codes.get(code);
        codes.delete(code); // single use
        if (grant === undefined || grant.redirectUri !== form.get('redirect_uri')) {
          return send(400, { error: 'invalid_grant' });
        }
        const verifier = form.get('code_verifier');
        if (grant.challenge !== undefined || idp.switches.requirePkce !== false) {
          const computed =
            verifier === null ? '' : createHash('sha256').update(verifier).digest('base64url');
          if (computed !== grant.challenge) return send(400, { error: 'invalid_grant' });
        }
        const user = users[grant.user] as BrowserIdpUser;
        const idToken = await sign({
          iss: `${base}/realm`,
          aud: clientId,
          sub: `pairwise-${user.oid.slice(0, 8)}`,
          nonce: idp.switches.wrongNonce === true ? 'not-the-nonce' : grant.nonce,
          iat: now(),
          exp: now() + 300,
        });
        return send(200, {
          access_token: await sign(accessClaims(user, idp.switches.accessTokenClaims)),
          token_type: 'Bearer',
          expires_in: 300,
          ...(idp.switches.omitIdToken !== true && { id_token: idToken }),
        });
      }
      if (url.pathname === '/realm/logout') return send(200, 'signed out', 'text/plain');
      send(404, 'not found', 'text/plain');
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function clientAuthenticated(
    req: IncomingMessage,
    form: URLSearchParams,
  ): Promise<'secret' | 'private-key' | 'none'> {
    const basic = req.headers.authorization;
    if (basic?.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(basic.slice(6), 'base64')
        .toString('utf8')
        .split(':')
        .map((p) => decodeURIComponent(p));
      return id === clientId && secret === clientSecret ? 'secret' : 'none';
    }
    const assertion = form.get('client_assertion');
    if (assertion !== null) {
      try {
        await jose.jwtVerify(assertion, client.publicKey, { issuer: clientId, subject: clientId });
        return 'private-key';
      } catch {
        return 'none';
      }
    }
    return 'none';
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://${host}:${(server.address() as AddressInfo).port}`;
  return idp;
}

function bodyOf(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    req.on('data', (c) => (text += String(c)));
    req.on('end', () => resolve(text));
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
