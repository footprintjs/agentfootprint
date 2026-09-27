/**
 * oidcSignIn — browser sign-in for the `oidc-token` strategy: the OpenID
 * Connect authorization-code flow, through `openid-client`.
 *
 * **Pending independent review.** The sign-in door is where the classic
 * sign-in bugs live; the owner gates the release of this piece on an outside
 * human security review (design Q5). It is built and tested; it is not yet
 * cleared for a company install.
 *
 * Pattern: Adapter over `openid-client` (an OpenID-certified relying party by
 *          the author of `jose`), behind the door's {@link RedirectSignIn}
 *          port. Optional peer, loaded lazily — the `jose` precedent.
 * Role:    the protocol half. The sign-in door owns the cookies, `returnTo`
 *          and the callback order; this file builds the authorization URL and
 *          turns a callback into a person.
 *
 * ── One verification path (design §5.3, Q1) ────────────────────────────────
 * The callback does NOT read the person out of the ID token. The same code
 * exchange returns an ACCESS token for this API, and the strategy's own
 * `verify` — the person test included — reads the person out of that. So a
 * person signing in through the browser and the same person calling with a
 * bearer token get the same `userId` by construction. The ID token only binds
 * the login to this browser (`nonce`) and is then dropped; nothing is stored.
 *
 * ── What `openid-client` checks, and what this file adds ───────────────────
 * `openid-client` checks `state`, the code exchange (client authentication +
 * PKCE verifier), and the ID token (signature, `iss`, `aud` = the client id,
 * `nonce`, `exp`, the clock tolerance). This file requires an ID token in every
 * token response (with PKCE off the nonce is the only defence against an
 * injected code), then runs `verify` on the access token.
 *
 * ── Client authentication ───────────────────────────────────────────────────
 * A private key (`private_key_jwt`, RFC 7523) is preferred: nothing shared
 * leaves the server. A client secret (`client_secret_basic`) is accepted —
 * design §5.2: "a secret file is accepted". Exactly one of the two.
 */

import { createPrivateKey, webcrypto } from 'node:crypto';

import { IdentityNotVerifiedError, VerifierUnavailableError } from '../../hosting/errors.js';
import {
  RedirectSignInError,
  type RedirectSignIn,
  type SignInAccepted,
  type SignInAttempt,
} from '../../hosting/signin/types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import type { OidcIdentity } from './oidc.js';
import type { DiscoveredIssuer } from './verify/discovery.js';

/**
 * The slice of `openid-client` v6 this adapter uses, declared structurally so
 * the optional peer is never a hard type dependency.
 */
export interface OpenIdClientBackend {
  Configuration: new (
    server: Record<string, unknown>,
    clientId: string,
    metadata?: Record<string, unknown>,
    clientAuthentication?: unknown,
  ) => unknown;
  buildAuthorizationUrl(config: unknown, parameters: Record<string, string>): URL;
  authorizationCodeGrant(
    config: unknown,
    currentUrl: URL,
    checks: Record<string, unknown>,
  ): Promise<{ access_token?: string; id_token?: string }>;
  buildEndSessionUrl(config: unknown, parameters: Record<string, string>): URL;
  calculatePKCECodeChallenge(verifier: string): Promise<string>;
  PrivateKeyJwt(key: unknown): unknown;
  ClientSecretBasic(secret: string): unknown;
  allowInsecureRequests(config: unknown): void;
  readonly clockTolerance: symbol;
}

/** How the client authenticates at the token endpoint. */
export type OidcClientCredential =
  | { readonly kind: 'private-key'; readonly pem: string }
  | { readonly kind: 'secret'; readonly secret: string };

export interface OidcSignInOptions {
  /** The strategy's own verifier — its `verify` reads the person from the access token. */
  readonly verifier: OidcIdentity;
  /** The browser client's id at the IdP (never the API's audience). */
  readonly clientId: string;
  readonly credential: OidcClientCredential;
  /** OAuth scopes to request; must include `openid` and this API's scope. */
  readonly scope: string;
  /** AD FS: the Web API identifier, sent as `resource` (else AD FS issues for userinfo). */
  readonly resource?: string;
  /** PKCE on (`'required'`, default) or off (`'off'`: AD FS 2016). */
  readonly pkce?: 'required' | 'off';
  /** A claim of the ACCESS token that carries the display name. */
  readonly displayNameClaim?: string;
  /** Seconds of clock skew for the ID token. Default 60. */
  readonly clockToleranceSeconds?: number;
  /** Accept `http` endpoints on a loopback host (development only). */
  readonly allowLoopbackHttp?: boolean;
  /** An already-imported `openid-client`. */
  readonly backend?: OpenIdClientBackend;
}

/** Raised when browser sign-in is configured and `openid-client` is not installed. */
export class MissingOpenIdClientError extends Error {
  readonly code = 'ERR_MISSING_OPENID_CLIENT' as const;

  constructor() {
    super(
      'oidc-token browser sign-in requires the `openid-client` peer dependency.\n' +
        '  Install:  npm install openid-client',
    );
    this.name = 'MissingOpenIdClientError';
  }
}

/**
 * A browser sign-in setting that can never work, found by `ready()` at boot —
 * `setting` names which: the client key (not RSA / EC P-256, or unreadable)
 * or the IdP's discovery document (no authorization or token endpoint, or
 * PKCE required and `S256` not offered).
 */
export class OidcSignInSetupError extends Error {
  readonly code = 'ERR_OIDC_SIGN_IN_SETUP' as const;
  readonly setting: 'client-key' | 'discovery';

  constructor(setting: 'client-key' | 'discovery', sentence: string) {
    super(`[identity] oidcSignIn: ${sentence}.`);
    this.name = 'OidcSignInSetupError';
    this.setting = setting;
  }
}

export function oidcSignIn(options: OidcSignInOptions): RedirectSignIn {
  checkOptions(options);
  const pkce = (options.pkce ?? 'required') === 'required';
  // The library and the client authentication: loaded ONCE, and at boot by
  // `ready()` — a missing library or a key of the wrong type is a refusal to
  // start, never a login that answers `unavailable` (review idI57 S-1).
  let loaded: Promise<{ lib: OpenIdClientBackend; auth: unknown }> | undefined;
  const pieces = () =>
    (loaded ??= (async () => {
      const lib = options.backend ?? (await loadOpenIdClient());
      const auth =
        options.credential.kind === 'private-key'
          ? lib.PrivateKeyJwt(await importSigningKey(options.credential.pem))
          : lib.ClientSecretBasic(options.credential.secret);
      return { lib, auth };
    })().catch((err) => {
      loaded = undefined;
      throw err;
    }));
  let configuration:
    | Promise<{ lib: OpenIdClientBackend; config: unknown; issuer: DiscoveredIssuer }>
    | undefined;

  const configured = () =>
    (configuration ??= (async () => {
      const state = await options.verifier.discover();
      if (state.kind !== 'ready') throw new RedirectSignInError('unavailable');
      const issuer = state.issuer;
      const problem = issuerProblem(issuer, pkce);
      if (problem !== undefined) throw new OidcSignInSetupError('discovery', problem);
      const { lib, auth } = await pieces();
      const config = new lib.Configuration(
        {
          issuer: issuer.issuer,
          authorization_endpoint: issuer.authorizationEndpoint,
          token_endpoint: issuer.tokenEndpoint,
          jwks_uri: issuer.jwksUri,
          ...(issuer.endSessionEndpoint !== undefined && {
            end_session_endpoint: issuer.endSessionEndpoint,
          }),
          // RFC 9207: advertised ⇒ required on the callback (review idI57 N-1).
          ...(issuer.issParameterSupported === true && {
            authorization_response_iss_parameter_supported: true,
          }),
        },
        options.clientId,
        {},
        auth,
      );
      (config as Record<symbol, unknown>)[lib.clockTolerance] = options.clockToleranceSeconds ?? 60;
      if (options.allowLoopbackHttp === true) lib.allowInsecureRequests(config);
      return { lib, config, issuer };
    })().catch((err) => {
      configuration = undefined;
      throw err;
    }));

  return {
    strategy: 'oidc-token',
    pkce,
    async ready(): Promise<void> {
      await pieces();
      const state = await options.verifier.discover();
      // An outage is not a refusal: the first login tries again.
      if (state.kind !== 'ready') return;
      const problem = issuerProblem(state.issuer, pkce);
      if (problem !== undefined) throw new OidcSignInSetupError('discovery', problem);
    },
    async authorizationUrl(attempt: SignInAttempt, redirectUri: string): Promise<string> {
      const { lib, config } = await configured();
      const parameters: Record<string, string> = {
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: options.scope,
        state: attempt.state,
        nonce: attempt.nonce,
        ...(options.resource !== undefined && { resource: options.resource }),
      };
      if (pkce) {
        if (attempt.codeVerifier === undefined) throw new RedirectSignInError('unavailable');
        parameters.code_challenge = await lib.calculatePKCECodeChallenge(attempt.codeVerifier);
        parameters.code_challenge_method = 'S256';
      }
      return lib.buildAuthorizationUrl(config, parameters).href;
    },

    async complete(callback: URL, attempt: SignInAttempt): Promise<SignInAccepted> {
      if (callback.searchParams.has('error')) throw new RedirectSignInError('idp-error');
      const { lib, config } = await configured();
      let tokens: { access_token?: string; id_token?: string };
      try {
        tokens = await lib.authorizationCodeGrant(config, callback, {
          expectedState: attempt.state,
          expectedNonce: attempt.nonce,
          idTokenExpected: true,
          ...(pkce && { pkceCodeVerifier: attempt.codeVerifier }),
        });
      } catch (err) {
        throw new RedirectSignInError(classifyGrantFailure(err));
      }
      // Every response must carry an ID token (the nonce binds the login to
      // this browser) and an access token for this API (the person).
      if (typeof tokens.id_token !== 'string' || tokens.id_token.length === 0) {
        throw new RedirectSignInError('id-token-refused');
      }
      if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) {
        throw new RedirectSignInError('not-a-person');
      }
      try {
        const identity = await options.verifier.verify(tokens.access_token);
        const shown =
          options.displayNameClaim === undefined
            ? undefined
            : identity.claims?.[options.displayNameClaim];
        return {
          identity: {
            userId: identity.userId,
            ...(identity.roles !== undefined && { roles: identity.roles }),
          },
          ...(typeof shown === 'string' && shown.length > 0 && { displayName: shown }),
        };
      } catch (err) {
        if (err instanceof VerifierUnavailableError) throw new RedirectSignInError('unavailable');
        if (err instanceof IdentityNotVerifiedError) throw new RedirectSignInError('not-a-person');
        throw new RedirectSignInError('not-a-person');
      }
    },

    async endSessionUrl(postLogoutRedirectUri: string): Promise<string | undefined> {
      const { lib, config, issuer } = await configured();
      if (issuer.endSessionEndpoint === undefined) return undefined;
      return lib.buildEndSessionUrl(config, {
        client_id: options.clientId,
        post_logout_redirect_uri: postLogoutRedirectUri,
      }).href;
    },
  };
}

/**
 * The grant failed: a network fault is `unavailable` (503-shaped); anything the
 * IdP or the ID-token check refused is a refusal. Only the CLASS travels — the
 * library's message can quote the IdP.
 */
function classifyGrantFailure(
  err: unknown,
): 'exchange-failed' | 'id-token-refused' | 'idp-error' | 'unavailable' {
  const e = err as { code?: unknown; name?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (e?.name === 'TypeError' || /TIMEOUT/i.test(code) || code === 'OAUTH_RESPONSE_IS_NOT_JSON') {
    return 'unavailable';
  }
  if (code === 'OAUTH_AUTHORIZATION_RESPONSE_ERROR') return 'idp-error';
  // The token endpoint said no (a spent code, a bad client credential, a
  // PKCE verifier that does not match).
  if (code === 'OAUTH_RESPONSE_BODY_ERROR' || code === 'OAUTH_WWW_AUTHENTICATE_CHALLENGE') {
    return 'exchange-failed';
  }
  // Everything else is the response failing a check: no ID token, a nonce,
  // an audience, an issuer or a signature that does not match.
  return 'id-token-refused';
}

/** Why a discovered issuer cannot run browser sign-in, or `undefined`. */
function issuerProblem(issuer: DiscoveredIssuer, pkce: boolean): string | undefined {
  if (issuer.authorizationEndpoint === undefined || issuer.tokenEndpoint === undefined) {
    return `the IdP's discovery document names no ${
      issuer.authorizationEndpoint === undefined ? 'authorization_endpoint' : 'token_endpoint'
    }, so a browser cannot sign in through it`;
  }
  const methods = issuer.codeChallengeMethods;
  if (pkce && methods !== undefined && !methods.includes('S256')) {
    return `PKCE is required, and the IdP's discovery document offers ${
      methods.length === 0 ? 'no PKCE method' : methods.join(', ')
    } but not S256`;
  }
  return undefined;
}

/** A PEM PKCS#8 private key → a Web Crypto signing key (RS256 or ES256). */
async function importSigningKey(pem: string): Promise<{ key: unknown; kid?: string }> {
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new OidcSignInSetupError(
      'client-key',
      'the client key does not parse as a private key (an encrypted PEM is not accepted)',
    );
  }
  const der = key.export({ type: 'pkcs8', format: 'der' });
  const type = key.asymmetricKeyType;
  if (type === 'rsa') {
    const imported = await webcrypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return { key: imported };
  }
  if (type === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
    const imported = await webcrypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return { key: imported };
  }
  throw new OidcSignInSetupError(
    'client-key',
    'the client key must be an RSA or an EC P-256 private key (PKCS#8 PEM)',
  );
}

function checkOptions(options: OidcSignInOptions): void {
  const refuse = (sentence: string): never => {
    throw new TypeError(`[identity] oidcSignIn: ${sentence}.`);
  };
  if (typeof options.clientId !== 'string' || options.clientId.length === 0)
    refuse('clientId is required');
  if (!/(^|\s)openid(\s|$)/.test(options.scope ?? '')) refuse(`scope must include 'openid'`);
  const credential = options.credential;
  if (credential?.kind === 'private-key') {
    if (typeof credential.pem !== 'string' || !credential.pem.includes('PRIVATE KEY')) {
      refuse('the client key is a PEM private key');
    }
  } else if (credential?.kind === 'secret') {
    if (typeof credential.secret !== 'string' || credential.secret.length === 0) {
      refuse('the client secret is empty');
    }
  } else {
    refuse('a client credential (a private key, or a secret) is required');
  }
  if (options.pkce !== undefined && options.pkce !== 'required' && options.pkce !== 'off') {
    refuse(`pkce is 'required' or 'off'`);
  }
}

/** Load `openid-client` (ESM-only) lazily, or refuse by name. */
async function loadOpenIdClient(): Promise<OpenIdClientBackend> {
  try {
    const spec = 'openid-client';
    return (await import(spec)) as unknown as OpenIdClientBackend;
  } catch {
    try {
      return lazyRequire<OpenIdClientBackend>('openid-client');
    } catch {
      throw new MissingOpenIdClientError();
    }
  }
}
