/**
 * hosting/signin/hostSignIn — a host's `signIn` option, judged once at
 * construction, plus the conversation door's per-socket sign-in watch.
 */

import { IdentityNotVerifiedError, VerifierUnavailableError } from '../errors.js';
import { verifyRequestIdentity, type DoorIdentity } from '../identityVerification.js';
import { isLoopbackBind, type CrossSiteOptions } from '../doorGuard.js';
import { SIGN_IN_COOKIE, type HostSignInOptions, type SignInSource } from './types.js';

/** The option, defaulted and checked. */
export interface ResolvedHostSignIn {
  readonly cookieName: string;
  readonly identity: DoorIdentity;
}

/** RFC 6265 cookie-name characters (an HTTP token). */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Refuse a half-spelled `signIn` by name, before a socket exists. */
export function checkHostSignIn(
  hostName: string,
  option: HostSignInOptions | undefined,
  door: CrossSiteOptions & { readonly bindHost?: string } = {},
): ResolvedHostSignIn | undefined {
  if (option === undefined) return undefined;
  refuseOpenBrowserRules(hostName, door);
  const cookieName = option.cookieName ?? SIGN_IN_COOKIE;
  if (typeof cookieName !== 'string' || !COOKIE_NAME.test(cookieName)) {
    throw new TypeError(
      `[hosting] ${hostName}: signIn.cookieName ${JSON.stringify(cookieName)} is not a cookie ` +
        `name (an HTTP token: letters, digits and !#$%&'*+-.^_\`|~).`,
    );
  }
  const identity = option.identity;
  if (
    identity === undefined ||
    identity === null ||
    (typeof identity.verify !== 'function' && typeof identity.signIn?.identify !== 'function')
  ) {
    throw new TypeError(
      `[hosting] ${hostName}: signIn needs 'identity' — the same object standingAgent takes — ` +
        `so the conversation door can verify a handshake before the 101. A door that stripped ` +
        `the cookie and checked nothing would hand a socket to anybody who asked.`,
    );
  }
  return { cookieName, identity };
}

/** Why a handshake is refused before the 101: the status and the error. */
export interface HandshakeRefusal {
  readonly status: 401 | 503;
  readonly error: IdentityNotVerifiedError | VerifierUnavailableError;
}

/**
 * Verify a handshake: the same funnel a request goes through. Resolves the
 * refusal, or `undefined` when the caller is proven.
 */
export async function checkHandshake(
  signIn: ResolvedHostSignIn,
  headers: Readonly<Record<string, string>>,
  signInKey: string | undefined,
): Promise<HandshakeRefusal | undefined> {
  try {
    await verifyRequestIdentity(signIn.identity, headers, undefined, signInKey);
    return undefined;
  } catch (err) {
    if (err instanceof VerifierUnavailableError) return { status: 503, error: err };
    if (err instanceof IdentityNotVerifiedError) return { status: 401, error: err };
    return { status: 401, error: new IdentityNotVerifiedError('unverifiable', false) };
  }
}

/**
 * Is the sign-in behind this socket still live? `'live'`, `'ended'`, or
 * `'unknown'` when the store could not answer (the frame is held back either
 * way; an unknown answer closes as an outage, never as a sign-out).
 */
export async function signInStillLive(
  source: SignInSource,
  key: string,
): Promise<'live' | 'ended' | 'unknown'> {
  try {
    return (await source.identify(key)) === undefined ? 'ended' : 'live';
  } catch {
    return 'unknown';
  }
}

/**
 * H1 on the host (review idI34 S-7): a host that carries a sign-in cookie must
 * keep the browser rules on. A cookie rides along on every forged request, and
 * `SameSite=Strict` does not stop a same-site sibling page — the door guard is
 * the defence. So, with `signIn`: never `allowedOrigins: 'any'` (unset means
 * this door's own host, an allowlist of one), never `requireJsonContentType:
 * false`, never `allowedHosts: 'any'`, and `allowedHosts` set unless the host
 * binds a loopback address.
 */
function refuseOpenBrowserRules(
  hostName: string,
  door: CrossSiteOptions & { readonly bindHost?: string },
): void {
  const refuse = (sentence: string): never => {
    throw new TypeError(
      `[hosting] ${hostName}: signIn needs the browser rules on — ${sentence}. A sign-in cookie ` +
        `rides along on every forged request, and the door guard is what refuses them.`,
    );
  };
  if (door.allowedOrigins === 'any') refuse(`allowedOrigins may not be 'any'`);
  if (door.requireJsonContentType === false) refuse('requireJsonContentType may not be false');
  if (door.allowedHosts === 'any') refuse(`allowedHosts may not be 'any'`);
  if (door.allowedHosts === undefined && !isLoopbackBind(door.bindHost)) {
    refuse(
      'allowedHosts must list the names people use (the host does not bind a loopback address)',
    );
  }
}
