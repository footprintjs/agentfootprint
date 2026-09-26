/**
 * verify/jwtCore — the one place a signed token is checked, shared by every
 * inbound verifier (`jwksIdentity`, `oidcIdentity`).
 *
 * Pattern: shared kernel. Two verifiers that each spelled "signature, issuer,
 *          audience, expiry" would be two answers to one question, and the day
 *          one of them required `exp` and the other did not is the day a token
 *          with no lifetime got through the lenient one.
 * Role:    load `jose`, map its failures onto the library's failure words, and
 *          hand back the verified claim set. Nothing here reads WHO the token
 *          is about: that is each verifier's own business.
 *
 * ── Every token expires ─────────────────────────────────────────────────────
 * `jose` checks `exp` only when a token carries one (6.2.8,
 * `validateClaimsSet`). A signed token WITHOUT `exp` would verify and never
 * expire — another token type signed by the same keys, or a proxy that forgot
 * the claim. So `exp` is required twice: `requiredClaims: ['exp']` for `jose`,
 * and a check of the returned claims for any other backend (a stub, a fork)
 * that ignores that option. Refused as `unverifiable`: the token is not one
 * this door reads, and `expired` would tell the client to refresh.
 */

import { IdentityNotVerifiedError, VerifierUnavailableError } from '../../../hosting/errors.js';
import { lazyRequire } from '../../../lib/lazyRequire.js';

/**
 * The slice of `jose` the inbound verifiers use — declared STRUCTURALLY, so a
 * stub, a pinned fork, or a future major satisfies it without this package
 * taking a hard type dependency on an optional peer. (The `UnpdfBackend`
 * precedent.)
 */
export interface JoseBackend {
  createRemoteJWKSet(url: URL, options?: Record<string, unknown>): unknown;
  jwtVerify(
    token: string,
    key: unknown,
    options?: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown> }>;
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

/**
 * The asymmetric families. Symmetric algorithms (`HS*`) are deliberately NOT
 * here: with a JWKS the key is public, and a verifier that accepts an HMAC alg
 * over a published key is the classic algorithm-confusion forgery.
 */
export const DEFAULT_ALGORITHMS: readonly string[] = [
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

type JoseFailure =
  | 'expired'
  | 'not-yet-valid'
  | 'wrong-audience'
  | 'wrong-issuer'
  | 'unverifiable'
  | 'keys-unavailable';

/**
 * `jose`'s stable error codes → this library's failure vocabulary.
 *
 * Mapped by CODE STRING rather than by `instanceof`, and that is the load-
 * bearing choice: the error classes are not on `jose`'s main entry point (they
 * live under `jose/errors`), the codes are documented as stable, and a string
 * comparison survives a duplicated copy of the library in a `node_modules` tree
 * — which `instanceof` famously does not.
 *
 * Every code is one the verifiers have SEEN the installed library produce; the
 * pin test (test/adapters/identity/jwks.test.ts) reproduces each one.
 */
export function joseFailureOf(err: unknown): JoseFailure {
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
      // `exp` MISSING lands here too (claim 'exp', reason 'missing').
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

/** What {@link verifySignedToken} checks the token against. */
export interface SignedTokenChecks {
  /** Accepted `iss` values — compared exactly. */
  readonly issuer: string | readonly string[];
  /** Accepted `aud` values. */
  readonly audience: string | readonly string[];
  readonly algorithms: readonly string[];
  /** Seconds of clock skew tolerated on `exp`/`nbf`. */
  readonly clockToleranceSeconds?: number;
  /** The verifier's name, for the 503 — never its configuration. */
  readonly verifierName: string;
}

/**
 * Check one token's signature and registered claims, and hand back its claim
 * set — or throw {@link IdentityNotVerifiedError} (the caller's token) /
 * {@link VerifierUnavailableError} (this deployment's key set).
 *
 * Neither error carries the token, the claims or the library's own text, and
 * the original is deliberately NOT attached as `cause`: a cause travels into
 * every serializer that walks own properties.
 */
export async function verifySignedToken(
  jose: JoseBackend,
  keys: unknown,
  token: string,
  checks: SignedTokenChecks,
): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jose.jwtVerify(token, keys, {
      issuer: checks.issuer as string | string[],
      audience: checks.audience as string | string[],
      algorithms: checks.algorithms as string[],
      requiredClaims: ['exp'],
      ...(checks.clockToleranceSeconds !== undefined && {
        clockTolerance: checks.clockToleranceSeconds,
      }),
    });
    payload = verified.payload;
  } catch (err) {
    const failure = joseFailureOf(err);
    if (failure === 'keys-unavailable') {
      throw new VerifierUnavailableError(checks.verifierName, 'its key set could not be fetched');
    }
    throw new IdentityNotVerifiedError(failure, false);
  }
  if (payload === null || typeof payload !== 'object') {
    throw new IdentityNotVerifiedError('unverifiable', false);
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    // The second half of "every token expires": a backend that ignored
    // `requiredClaims` does not get to hand back a token with no lifetime.
    throw new IdentityNotVerifiedError('unverifiable', false);
  }
  // And its TIME, not only its presence: a backend that skipped the clock
  // checks (a stub, a fork) does not get to hand back an expired token either.
  // The same tolerance `jose` was given, the same classes.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tolerance = checks.clockToleranceSeconds ?? 0;
  // `<=`, as jose itself decides: a token is expired AT its `exp` second.
  if (payload.exp + tolerance <= nowSeconds) throw new IdentityNotVerifiedError('expired', false);
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
      throw new IdentityNotVerifiedError('unverifiable', false);
    }
    if (payload.nbf - tolerance > nowSeconds) {
      throw new IdentityNotVerifiedError('not-yet-valid', false);
    }
  }
  return payload;
}

/**
 * Load `jose`, or refuse by name.
 *
 * `jose` v6 is ESM-only, so a dynamic import is tried first and the CJS require
 * is the fallback — one of the two works on every runtime this package
 * supports. (The `unpdf` loader's shape, for the same reason.)
 */
export async function loadJose(): Promise<JoseBackend> {
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
