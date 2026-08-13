/**
 * jwksIdentity — verify the caller's bearer token against a published key set.
 *
 * Pattern: Adapter (GoF) over `jose`, behind the vendor-neutral
 *          {@link IdentityVerifier} port.
 * Role:    the ONE identity verifier this release ships. It covers cloud IdPs
 *          and on-prem ones with the same code, because JWKS is the same
 *          protocol in both: a URL that publishes signing keys, and tokens
 *          signed by one of them.
 * Emits:   nothing. The door that called it reports the refusal — by CLASS.
 *
 * ── What it checks, and what it refuses to pretend to check ─────────────────
 * Signature (against the key the token's `kid` names, fetched and cached from
 * `jwksUrl`), `iss`, `aud`, `exp` and `nbf`. That is the whole list, and it is
 * the whole list on purpose:
 *
 *   • **It is not an authorization decision.** A verified token proves WHO, not
 *     WHAT-THEY-MAY-DO. Roles and claims come back on the result so your own
 *     policy can decide; this adapter never reads them.
 *   • **It does not check revocation.** A JWT is valid until it expires, and no
 *     amount of key fetching changes that. Short lifetimes are the answer; an
 *     adapter that implied otherwise would be selling a guarantee the protocol
 *     does not make.
 *   • **`alg: none` cannot get through**, because a JWKS resolver has no key for
 *     it — verified against the real library rather than assumed (see the pin
 *     test). Neither can a token signed with an algorithm outside `algorithms`.
 *
 * ── The token never comes back out ──────────────────────────────────────────
 * Every failure is re-raised as {@link IdentityNotVerifiedError} carrying only
 * the CLASS — `expired`, `wrong-audience`, `wrong-issuer`, `not-yet-valid`,
 * `unverifiable`. The library's own message is dropped, and the original is
 * deliberately NOT attached as `cause`: a cause travels into every serializer
 * that walks own properties, and one `JSON.stringify` would undo all of this.
 * (The `sdkFailure` law, applied to a credential rather than to a cloud SDK.)
 *
 * A key set this adapter could not FETCH is a different fact and gets a
 * different class: {@link VerifierUnavailableError}, which the host answers 503
 * rather than 401. Your IdP being down is not the caller presenting a bad
 * token, and telling every client to re-authenticate against an unreachable
 * provider is the wrong instruction at the worst moment.
 *
 * @example
 *   const host = await standingAgent({
 *     agent, sessions, host: nodeHost({ port: 8080 }),
 *     identity: { verify: jwksIdentity({
 *       jwksUrl:  'https://idp.example.com/.well-known/jwks.json',
 *       issuer:   'https://idp.example.com/',
 *       audience: 'my-api',
 *     }).verify },
 *   });
 */

import { IdentityNotVerifiedError, VerifierUnavailableError } from '../../hosting/errors.js';
import type { IdentityVerifier, VerifiedIdentity } from '../../hosting/identityVerification.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

/**
 * The slice of `jose` this adapter uses — declared STRUCTURALLY, so a stub, a
 * pinned fork, or a future major satisfies it without this package taking a
 * hard type dependency on an optional peer. (The `UnpdfBackend` precedent.)
 */
export interface JoseBackend {
  createRemoteJWKSet(url: URL, options?: Record<string, unknown>): unknown;
  jwtVerify(
    token: string,
    key: unknown,
    options?: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown> }>;
}

export interface JwksIdentityOptions {
  /** Where the signing keys are published — an IdP's
   *  `.../.well-known/jwks.json`. */
  readonly jwksUrl: string;
  /** The `iss` every accepted token must carry. Required: a verifier that
   *  accepted any issuer would accept a token minted by anybody who publishes
   *  a key set. */
  readonly issuer: string | readonly string[];
  /** The `aud` every accepted token must carry — THIS API's name at the IdP.
   *  Required for the same reason: a token minted for a different service is
   *  a valid token, and honouring it is confused-deputy by construction. */
  readonly audience: string | readonly string[];
  /**
   * Which claim names the user. Default `'sub'` — the subject, which is what
   * `sub` means. Point it at `'email'`, `'oid'` or a namespaced claim when your
   * IdP's stable id lives elsewhere; a token whose chosen claim is missing or
   * blank is `unverifiable`, never silently anonymous.
   */
  readonly userIdClaim?: string;
  /**
   * Which claim carries roles. Default `'roles'`. Read leniently — a string,
   * an array of strings, or a space-delimited string (the `scope` convention) —
   * and ABSENT when the claim is absent. Never invented.
   */
  readonly rolesClaim?: string;
  /**
   * Signature algorithms to accept. Default: the RSA and ECDSA families
   * (`RS256/384/512`, `PS256/384/512`, `ES256/384/512`).
   *
   * Symmetric algorithms (`HS*`) are deliberately NOT in the default: with a
   * JWKS the key is public, and a verifier that accepts an HMAC alg over a
   * published key is the classic algorithm-confusion forgery. Name them
   * explicitly if a deployment genuinely needs one and you know why.
   */
  readonly algorithms?: readonly string[];
  /** Seconds of clock skew tolerated on `exp`/`nbf`. Default 0 — the library
   *  does not decide how much drift your fleet has. */
  readonly clockToleranceSeconds?: number;
  /** How long a fetched key set is reused before re-fetching, in ms. Default
   *  is `jose`'s own (10 minutes). */
  readonly cacheMaxAgeMs?: number;
  /** Timeout for the key-set fetch, in ms. Default is `jose`'s own (5s). */
  readonly fetchTimeoutMs?: number;
  /**
   * An ALREADY-IMPORTED `jose`. Supply it and the lazy load never happens —
   * which is what makes this work in a BUNDLED app, where a bare specifier
   * reaches the runtime unresolved:
   *
   * ```ts
   * import * as jose from 'jose';
   * jwksIdentity({ jwksUrl, issuer, audience, backend: jose });
   * ```
   */
  readonly backend?: JoseBackend;
}

/** Raised when a token must be verified and `jose` is not installed. */
export class MissingJwksSupportError extends Error {
  readonly code = 'ERR_MISSING_JWKS_SUPPORT' as const;

  constructor() {
    super(
      'jwksIdentity requires the `jose` peer dependency.\n' +
        '  Install:  npm install jose\n' +
        '  Or pass `backend` to jwksIdentity() if your bundler resolves it statically.',
    );
    this.name = 'MissingJwksSupportError';
  }
}

/** The asymmetric families. See {@link JwksIdentityOptions.algorithms}. */
const DEFAULT_ALGORITHMS: readonly string[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
];

/**
 * `jose`'s stable error codes → this library's failure vocabulary.
 *
 * Mapped by CODE STRING rather than by `instanceof`, and that is the load-
 * bearing choice: the error classes are not on `jose`'s main entry point (they
 * live under `jose/errors`), the codes are documented as stable, and a string
 * comparison survives a duplicated copy of the library in a `node_modules` tree
 * — which `instanceof` famously does not.
 *
 * Every code is one this adapter has SEEN the installed library produce; the
 * pin test reproduces each one against the real package.
 */
function classOf(
  err: unknown,
):
  | 'expired'
  | 'not-yet-valid'
  | 'wrong-audience'
  | 'wrong-issuer'
  | 'unverifiable'
  | 'keys-unavailable' {
  const e = err as { code?: unknown; claim?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
      const claim = typeof e?.claim === 'string' ? e.claim : undefined;
      if (claim === 'aud') return 'wrong-audience';
      if (claim === 'iss') return 'wrong-issuer';
      if (claim === 'nbf') return 'not-yet-valid';
      return 'unverifiable';
    }
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWKS_NO_MATCHING_KEY':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
    case 'ERR_JWK_INVALID':
    case 'ERR_JWKS_INVALID':
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
    case 'ERR_JOSE_NOT_SUPPORTED':
      return 'unverifiable';
    case 'ERR_JWKS_TIMEOUT':
      return 'keys-unavailable';
    default:
      // No JOSE code at all. A key-set fetch that failed surfaces here as the
      // runtime's own `TypeError: fetch failed` — an outage on THIS side, and
      // answering it 401 would send every client to re-authenticate against a
      // provider that is already down.
      return code === undefined ? 'keys-unavailable' : 'unverifiable';
  }
}

/** Roles out of a claim, read leniently and never invented. */
function rolesOf(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value)) {
    const roles = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
    return roles.length > 0 ? roles : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    // The `scope` convention: one space-delimited string.
    const roles = value.trim().split(/\s+/);
    return roles.length > 0 ? roles : undefined;
  }
  return undefined;
}

export function jwksIdentity(options: JwksIdentityOptions): IdentityVerifier {
  const { jwksUrl } = options;
  if (typeof jwksUrl !== 'string' || jwksUrl.trim().length === 0) {
    throw new TypeError(
      `[identity] jwksIdentity({ jwksUrl: ${JSON.stringify(jwksUrl)} }) needs the URL your ` +
        `identity provider publishes its signing keys at — usually ` +
        `'<issuer>/.well-known/jwks.json'.`,
    );
  }
  let url: URL;
  try {
    url = new URL(jwksUrl);
  } catch {
    throw new TypeError(
      `[identity] jwksIdentity({ jwksUrl: '${jwksUrl}' }) is not an absolute URL. Key sets are ` +
        `fetched over the network, so a relative path has nothing to resolve against.`,
    );
  }
  if (emptyName(options.issuer)) {
    throw new TypeError(
      `[identity] jwksIdentity needs an \`issuer\`. A verifier that accepted any issuer would ` +
        `accept a token minted by anybody who publishes a key set — which is not verification, ` +
        `it is a signature check with no opinion about who signed.`,
    );
  }
  if (emptyName(options.audience)) {
    throw new TypeError(
      `[identity] jwksIdentity needs an \`audience\` — this API's name at your identity ` +
        `provider. Without it a token minted for a DIFFERENT service verifies here, which is ` +
        `the confused-deputy shape: a valid credential, honoured by the wrong door.`,
    );
  }
  const userIdClaim = options.userIdClaim ?? 'sub';
  const rolesClaim = options.rolesClaim ?? 'roles';
  const algorithms = options.algorithms ?? DEFAULT_ALGORITHMS;

  /** The key-set resolver, built once and reused — `jose` caches inside it. */
  let resolver: Promise<{ jose: JoseBackend; keys: unknown }> | undefined;
  const getResolver = (): Promise<{ jose: JoseBackend; keys: unknown }> =>
    (resolver ??= (async () => {
      const jose = options.backend ?? (await loadJose());
      const keys = jose.createRemoteJWKSet(url, {
        ...(options.cacheMaxAgeMs !== undefined && { cacheMaxAge: options.cacheMaxAgeMs }),
        ...(options.fetchTimeoutMs !== undefined && { timeoutDuration: options.fetchTimeoutMs }),
      });
      return { jose, keys };
    })().catch((err) => {
      // A failed BUILD is not cached — a bundler hiccup or a transient import
      // failure must not permanently poison the verifier.
      resolver = undefined;
      throw err;
    }));

  return {
    async verify(token: string): Promise<VerifiedIdentity> {
      const { jose, keys } = await getResolver();
      let payload: Record<string, unknown>;
      try {
        const verified = await jose.jwtVerify(token, keys, {
          issuer: options.issuer as string | string[],
          audience: options.audience as string | string[],
          algorithms: algorithms as string[],
          ...(options.clockToleranceSeconds !== undefined && {
            clockTolerance: options.clockToleranceSeconds,
          }),
        });
        payload = verified.payload;
      } catch (err) {
        const failure = classOf(err);
        // The one place the two shapes diverge: an unreachable key set is this
        // deployment's outage (503), everything else is the caller's token
        // (401). Neither carries the token, the claims, or the library's text.
        if (failure === 'keys-unavailable') {
          throw new VerifierUnavailableError('jwksIdentity', 'its key set could not be fetched');
        }
        throw new IdentityNotVerifiedError(failure, false);
      }
      const userId = payload[userIdClaim];
      if (typeof userId !== 'string' || userId.length === 0) {
        // A perfectly valid token that does not say who it is about. Refused
        // rather than served anonymously: "verified, subject unknown" is a
        // state nothing downstream could act on honestly.
        throw new IdentityNotVerifiedError('unverifiable', false);
      }
      const roles = rolesOf(payload[rolesClaim]);
      return {
        userId,
        ...(roles !== undefined && { roles }),
        claims: payload,
      };
    },
  };
}

function emptyName(value: string | readonly string[] | undefined): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0 || value.some((v) => typeof v !== 'string');
  return true;
}

/**
 * Load `jose`, or refuse by name.
 *
 * `jose` v6 is ESM-only, so a dynamic import is tried first and the CJS require
 * is the fallback — one of the two works on every runtime this package
 * supports. (The `unpdf` loader's shape, for the same reason.)
 */
async function loadJose(): Promise<JoseBackend> {
  try {
    const spec = 'jose';
    return (await import(spec)) as unknown as JoseBackend;
  } catch {
    try {
      return lazyRequire<JoseBackend>('jose');
    } catch {
      throw new MissingJwksSupportError();
    }
  }
}
