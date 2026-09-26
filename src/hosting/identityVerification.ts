/**
 * hosting/identityVerification — the door checks the badge, instead of reading
 * the name off it.
 *
 * Until 9.26 the hosting port had exactly one honest sentence about WHO is
 * calling: `HostRequest.userId` is "what the transport said", and how much that
 * is worth is the transport's answer. A managed runtime that authenticates in
 * front of the container can fill it in; a container you expose yourself cannot,
 * because a header there is a string anybody can send. That sentence is still
 * true. This module is the other half of it: a way to make the door itself the
 * thing that knows, so a deployment does not have to choose between "trust a
 * header" and "no identity at all".
 *
 * ── The shape: one strategy, one method ──────────────────────────────────────
 * {@link IdentityVerifier} takes the bearer token off the wire and hands back
 * {@link VerifiedIdentity} — `{ userId, roles?, claims? }` — or throws. It is
 * vendor-neutral by construction: a JWT from any IdP, an opaque token
 * introspected against a server, a mutual-TLS thumbprint an edge proxy already
 * checked. `jwksIdentity({ jwksUrl, issuer, audience })` is the one adapter
 * this release ships, and it covers cloud IdPs and on-prem ones alike because
 * JWKS is the same protocol in both.
 *
 * ── Where it sits, exactly ───────────────────────────────────────────────────
 * BEFORE `identityForRequest` composes the run's scope. That ordering is the
 * whole feature: the composed scope is what memory namespaces on, what
 * artifacts isolate on, and what a credential provider scopes a token vault on.
 * Verifying after any of that would be checking the badge on the way out.
 *
 * ── The refusal law, and why it is not optional ──────────────────────────────
 * With a verifier configured, a request that names a `userId` and cannot prove
 * it is REFUSED — never quietly downgraded to anonymous, and never served under
 * the name it claimed. Both alternatives are the accepted-and-silently-wrong
 * failure wearing different clothes: one produces an audit trail that names the
 * wrong party, the other produces a door that anybody opens by omitting a
 * field.
 *
 * ── Secrets never travel ─────────────────────────────────────────────────────
 * A bearer token is a credential. It never appears in an error message, an
 * event payload, a log line or a reply body — not truncated, not fingerprinted,
 * not "just the first 8 characters". What travels is the CLASS of the failure
 * ({@link IdentityFailureClass}) and nothing else, which is exactly what an
 * operator needs to act (`expired` → the client should refresh;
 * `wrong-audience` → the client is pointed at the wrong API;
 * `keys-unavailable` → your IdP is unreachable and this is not the caller's
 * fault). That is the `sdkFailure` law, applied to the front door.
 */

import { IdentityNotVerifiedError, VerifierUnavailableError } from './errors.js';
import type { IdentityFailureClass } from './errors.js';
import type { SignInSource } from './signin/types.js';

/**
 * What a verifier proved. The badge, read after it was checked.
 *
 * Deliberately NOT a `MemoryIdentity`: this is evidence about a PERSON, and the
 * run's identity is a tenant/principal/conversation TUPLE the composer builds
 * from this plus the session. Keeping them separate is what stops a verifier
 * from silently re-namespacing somebody's conversation by returning a field.
 */
export interface VerifiedIdentity {
  /** The end user's id — what becomes {@link HostRequest.userId} and, through
   *  `identityForRequest`, the run's `principal`. Non-empty by contract; a
   *  verifier that cannot name the subject must throw rather than invent one. */
  readonly userId: string;
  /**
   * Roles the token asserted, when it asserted any.
   *
   * These reach the ADMISSION policy (`admission.decide({ identity, … })`) and
   * the session-history ops, and nothing else — they do not enter the run's
   * identity, which stays the three-field tuple every store already scopes on.
   * Stated rather than implied, because "the agent can see my roles" is exactly
   * the kind of belief that gets built on.
   */
  readonly roles?: readonly string[];
  /**
   * The verified claim set, as the verifier read it. Whatever an authorization
   * decision in THIS deployment needs (a tenant claim, a plan, a scope list)
   * and this library has no business interpreting.
   *
   * Never logged and never emitted by the framework — a claim set routinely
   * carries an email, and one echo puts it in every sink.
   */
  readonly claims?: Readonly<Record<string, unknown>>;
}

/**
 * The port — one method, vendor-neutral.
 *
 * `verify` is handed the RAW bearer token exactly as the wire delivered it
 * (without the `Bearer ` prefix) and must either return a
 * {@link VerifiedIdentity} or throw. Throwing an
 * {@link IdentityNotVerifiedError} names the failure class; throwing anything
 * else is treated as `'unverifiable'`, because a verifier that failed in a way
 * it did not describe has not verified anything.
 *
 * Implementations must never put the token into what they throw.
 */
export interface IdentityVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

/**
 * How a host door is told to check badges — {@link StandingAgentBaseOptions.identity}.
 *
 * Two credential sources, and a door may have either or both:
 *
 *  - `verify` — a TOKEN the request presents (`Authorization: Bearer …`, or
 *    the header named by {@link tokenHeader});
 *  - `signIn` — a SIGN-IN the server keeps, named by the key the transport
 *    passes after stripping the sign-in cookie (`HostRequest.signInKey`).
 *
 * `verify` may be left out only when `signIn` is present. With neither `signIn`
 * nor `tokenHeader` set, this is the 9.26 option exactly, and every request is
 * judged exactly as it was.
 */
export type IdentityVerificationOptions =
  | (IdentityVerificationBase & {
      /** The strategy. `jwksIdentity({ … })`, `oidcIdentity({ … })`, or any {@link IdentityVerifier}. */
      readonly verify: IdentityVerifier['verify'];
      readonly signIn?: SignInSource;
    })
  | (IdentityVerificationBase & {
      /** Absent: this door accepts sign-ins only, and a presented token is `unverifiable`. */
      readonly verify?: undefined;
      /** The sign-ins this door accepts (`signInSource({ store, idleMinutes })`). */
      readonly signIn: SignInSource;
    });

/** The fields both shapes of {@link IdentityVerificationOptions} share. */
export interface IdentityVerificationBase {
  /**
   * Let a request that presents NO credential through as anonymous.
   * Default **`false`** — configuring a verifier closes the door.
   *
   * The default is the load-bearing half. A door that verifies a token when one
   * is offered and waves the request through when it is not is a door anybody
   * opens by sending less, and every per-user bound built on top of it (spend
   * ceilings, session listing) evaporates for exactly the callers those bounds
   * exist for.
   *
   * Say `true` when a deployment genuinely serves both — a public demo lane and
   * a signed-in lane on one host. An anonymous request can then never carry a
   * `userId`: it is refused rather than served under a name nobody proved.
   */
  readonly allowAnonymous?: boolean;
  /**
   * Which header carries the token, lower-case. Default `'authorization'`,
   * read as `Bearer <token>`. Any other name is read as the raw token (a
   * leading `Bearer ` is tolerated) — the header an authenticating proxy
   * forwards a signed token in.
   */
  readonly tokenHeader?: string;
}

/**
 * Pull the bearer token out of the delivered transport headers.
 *
 * ONE extraction, so every dialect's tokens are read the same way. The header
 * is `Authorization: Bearer <token>` — the vocabulary every transport this
 * package speaks already normalizes onto:
 *
 *  - `httpHost` (and therefore `nodeHost` / `jsonWire`) hands the handler the
 *    request's lower-cased headers verbatim, so the token is simply there;
 *  - the managed-runtime dialect maps its own bearer SUBPROTOCOL onto
 *    `headers.authorization` before the port ever sees it, which is why that
 *    mapping was written the way it was;
 *  - a custom `HttpWire` that carries the credential somewhere else supplies
 *    the header itself, or wraps its own verifier.
 *
 * The scheme match is case-insensitive (RFC 7235 says it is), and a header with
 * a different scheme returns `undefined` rather than being half-read — handing
 * a Basic credential to a JWT verifier would produce a confusing refusal about
 * the wrong thing.
 */
export function bearerToken(
  headers: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const raw = headers?.authorization ?? headers?.Authorization;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const space = raw.indexOf(' ');
  if (space < 0) return undefined;
  if (raw.slice(0, space).toLowerCase() !== 'bearer') return undefined;
  const token = raw.slice(space + 1).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * The token a request presents under `options.tokenHeader` — `bearerToken` for
 * the default `authorization`, the raw (trimmed) value for any other header.
 */
export function presentedToken(
  headers: Readonly<Record<string, string>> | undefined,
  tokenHeader: string | undefined,
): string | undefined {
  if (tokenHeader === undefined || tokenHeader.toLowerCase() === 'authorization') {
    return bearerToken(headers);
  }
  const raw = headers?.[tokenHeader.toLowerCase()];
  if (typeof raw !== 'string') return undefined;
  const token = raw.replace(/^bearer\s+/i, '').trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Run one request's verification and hand back the proven identity — or refuse.
 *
 * Shared by every door on the composer (a turn, an artifact redemption, a
 * session-history op) so all three inherit one answer to "who is this", and a
 * later door cannot accidentally be the lenient one.
 *
 * @param options   the configured verifier, or `undefined` — with `undefined`
 *                  this returns `undefined` immediately and NOTHING about the
 *                  request changes (the zero-delta path).
 * @param headers   the delivered transport headers.
 * @param claimedUserId  what the transport put on `HostRequest.userId`.
 * @param signInKey what the transport put on `HostRequest.signInKey` — the
 *                  sign-in cookie's key, the cookie itself already stripped.
 *
 * One credential per request (rule 13): a token AND a sign-in together are
 * refused as `'two-credentials'` — which one to believe is not a question a
 * door should answer. A sign-in that ended, expired or never existed is
 * `'expired'`, one answer for all three. A sign-in store that cannot answer is
 * {@link VerifierUnavailableError} (503), never a signed-out caller.
 */
export async function verifyRequestIdentity(
  options: IdentityVerificationOptions | undefined,
  headers: Readonly<Record<string, string>> | undefined,
  claimedUserId: string | undefined,
  signInKey?: string,
): Promise<VerifiedIdentity | undefined> {
  if (options === undefined) return undefined;
  const token = presentedToken(headers, options.tokenHeader);
  if (signInKey !== undefined && token !== undefined) {
    throw new IdentityNotVerifiedError('two-credentials', claimedUserId !== undefined);
  }
  if (signInKey !== undefined && options.signIn !== undefined) {
    return accepted(await signedIn(options.signIn, signInKey), claimedUserId);
  }
  if (token === undefined) {
    // No badge. Whether that is allowed is the operator's call — but a request
    // that NAMED a user without one is refused either way, because that is the
    // header this whole module exists to stop being trusted.
    if (claimedUserId !== undefined) throw new IdentityNotVerifiedError('no-token', true);
    if (options.allowAnonymous === true) return undefined;
    throw new IdentityNotVerifiedError('no-token', false);
  }
  // A token at a door that takes sign-ins only: nothing here can check it.
  if (typeof options.verify !== 'function')
    throw new IdentityNotVerifiedError('unverifiable', false);
  let verified: VerifiedIdentity;
  try {
    verified = await options.verify(token);
  } catch (err) {
    // A verifier that named its failure class keeps it. Anything else is
    // `'unverifiable'` — including a bug in the verifier, because a verifier
    // that failed in a way it did not describe has proven nothing.
    if (err instanceof IdentityNotVerifiedError || err instanceof VerifierUnavailableError)
      throw err;
    throw new IdentityNotVerifiedError('unverifiable', false);
  }
  return accepted(verified, claimedUserId);
}

/** The person behind a sign-in key, or the refusal. A store fault is an outage. */
async function signedIn(source: SignInSource, key: string): Promise<VerifiedIdentity> {
  let who: VerifiedIdentity | undefined;
  try {
    who = await source.identify(key);
  } catch (err) {
    if (err instanceof IdentityNotVerifiedError || err instanceof VerifierUnavailableError)
      throw err;
    throw new VerifierUnavailableError('sign-in', 'its sign-in store could not answer');
  }
  if (who === undefined) throw new IdentityNotVerifiedError('expired', false);
  return who;
}

/** The checks every proven identity passes, whichever credential proved it. */
function accepted(verified: VerifiedIdentity, claimedUserId: string | undefined): VerifiedIdentity {
  if (
    verified === null ||
    typeof verified !== 'object' ||
    typeof verified.userId !== 'string' ||
    verified.userId.length === 0
  ) {
    // A verifier that resolved without naming a subject has not identified
    // anybody. Serving that as "verified" is the silent failure.
    throw new IdentityNotVerifiedError('unverifiable', false);
  }
  if (claimedUserId !== undefined && claimedUserId !== verified.userId) {
    // The token proves one person and the request signs another's name. Never
    // resolved in favour of either: one of the two facts is a lie, and this
    // door cannot know which.
    throw new IdentityNotVerifiedError('claimed-another-user', true);
  }
  return verified;
}

/** Re-exported so a consumer typing a verifier reads one vocabulary. */
export type { IdentityFailureClass };
