/**
 * hosting/signin/types — the sign-in: what the server keeps about a person who
 * proved who they are through a browser, and the two ports around it.
 *
 * A sign-in is the SERVER's record. The browser holds only a random value in
 * an `HttpOnly` cookie; the store is keyed by that value's SHA-256 (the
 * **sign-in key**), so a leaked store row is not a live cookie, and the key the
 * transport hands onward cannot be turned back into one.
 *
 * Two ports, because two different parties need two different things:
 *
 *  - {@link SignInStore} — where sign-ins are KEPT. Four verbs, no policy. An
 *    in-memory adapter ships (`memorySignIns`); a shared one (a database) is an
 *    app adapter behind the same four verbs.
 *  - {@link SignInSource} — what a DOOR asks: "who is behind this key, right
 *    now?" Lifetimes live here, not in the store (`signInSource`), so a store
 *    never decides whether a sign-in is still good.
 */

import type { IdentityVerificationOptions, VerifiedIdentity } from '../identityVerification.js';

/**
 * The sign-in cookie's name. `__Host-` makes the browser refuse it unless it is
 * `Secure`, has `Path=/` and no `Domain` — so a sibling host cannot plant one —
 * and `__Host-Http-` additionally refuses one set by script (RFC 10017
 * §6.1.3.2). A browser that does not know the newer prefix still enforces
 * `__Host-`, because the name starts with it.
 */
export const SIGN_IN_COOKIE = '__Host-Http-af-signin';

/**
 * The cookie's name on plain-`http` localhost, where the browser would refuse
 * the `__Host-` prefix (it requires `Secure`). Development only: the
 * sign-in door refuses it in production.
 */
export const SIGN_IN_COOKIE_LOCALHOST = 'af-signin';

/** One sign-in, as the store keeps it. No IdP token, no password — ever. */
export interface SignIn {
  /** The SHA-256 of the cookie's value, base64url. The store's key; not a credential. */
  readonly key: string;
  /** What the strategy proved. `userId` is the owner of everything this person does. */
  readonly identity: VerifiedIdentity;
  /** What the page shows. Can change; never an id, never an owner. */
  readonly displayName?: string;
  /** Which strategy created it (`local-password`, `oidc-token`, …). */
  readonly strategy: string;
  /** When it started, epoch ms. */
  readonly startedAt: number;
  /** When it ends whatever happens (the absolute lifetime), epoch ms. */
  readonly expiresAt: number;
  /** The last request it was seen on, epoch ms — the idle clock. */
  readonly lastSeenAt: number;
}

/**
 * Where sign-ins are kept. Four verbs and no policy: a store never decides
 * whether a sign-in is still good — {@link SignInSource} does.
 *
 * `find` of an unknown key resolves `undefined`; `touch` and `delete` of an
 * unknown key are no-ops. A store that cannot answer throws, and the door
 * answers 503: an outage is never a signed-out caller.
 */
export interface SignInStore {
  create(signIn: SignIn): Promise<void>;
  find(key: string): Promise<SignIn | undefined>;
  touch(key: string, at: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * What a door asks about a sign-in key — the port `IdentityVerificationOptions`
 * and the conversation door consume.
 */
export interface SignInSource {
  /**
   * The person behind a LIVE sign-in, or `undefined` when it ended, expired,
   * went idle or never existed — deliberately one answer, so a guessed key
   * learns nothing. Counts as activity (the idle clock restarts).
   */
  identify(key: string): Promise<VerifiedIdentity | undefined>;
  /**
   * Be told when a sign-in ends — sign-out, or an expiry found by `identify` —
   * so an open socket carrying it closes instead of outliving it. Optional and
   * feature-detected: without it, a socket still closes on its next frame.
   * Returns an unsubscribe.
   */
  onEnd?(listener: (key: string) => void): () => void;
}

/**
 * A host built with a sign-in cookie — `httpHost({ signIn })` /
 * `nodeHost({ signIn })`.
 *
 * With it, the transport strips the cookie from every header bag it hands
 * onward and passes the sign-in KEY instead (`HostRequest.signInKey`,
 * `HostConversation.signInKey`); and the conversation door checks every
 * handshake with {@link identity} BEFORE the 101, re-checks the sign-in before
 * handing on each inbound frame, and closes the socket when the sign-in ends.
 * Without it, nothing about either door changes.
 */
export interface HostSignInOptions {
  /** The cookie's name. Default {@link SIGN_IN_COOKIE}. */
  readonly cookieName?: string;
  /**
   * How a conversation handshake is verified — the same object
   * `standingAgent({ identity })` takes. Required: a door that stripped the
   * cookie and checked nothing would hand a socket to anybody who asked.
   */
  readonly identity: IdentityVerificationOptions;
}

/** What a password strategy proved. */
export interface PasswordAccepted {
  /** The person. `userId` is the owner of everything they do. */
  readonly identity: VerifiedIdentity;
  /** What the page shows. Never an id. */
  readonly displayName?: string;
}

/**
 * A password strategy: `local-password` today, `directory-password` later.
 * Resolves the person, or `undefined` for ANY wrong credential — unknown name,
 * wrong password, disabled account — so the sign-in door gives one answer for
 * all of them. Throws only when it could not check at all (a directory that is
 * down), which the door answers 503.
 *
 * The password is never stored, logged or forwarded by the door, and a checker
 * must not do so either.
 */
export interface PasswordChecker {
  /** Which strategy this is, recorded on the sign-in. */
  readonly strategy: string;
  check(username: string, password: string): Promise<PasswordAccepted | undefined>;
}

/** What a sign-in strategy proved — the same shape for a password and a redirect. */
export type SignInAccepted = PasswordAccepted;

/**
 * One browser sign-in attempt's secrets. The door makes them, seals them into
 * the attempt's transaction cookie, and hands them back at the callback.
 */
export interface SignInAttempt {
  readonly state: string;
  readonly nonce: string;
  /** Absent when PKCE is off. */
  readonly codeVerifier?: string;
}

/** Why a redirect callback did not sign anybody in — a code, never the IdP's own words. */
export type RedirectFailure =
  | 'idp-error'
  | 'exchange-failed'
  | 'id-token-refused'
  | 'not-a-person'
  | 'unavailable';

/** A callback that did not sign anybody in. Carries a reason CODE only. */
export class RedirectSignInError extends Error {
  readonly code = 'ERR_REDIRECT_SIGN_IN' as const;
  readonly reason: RedirectFailure;

  constructor(reason: RedirectFailure) {
    super(`[hosting] the sign-in did not complete (${reason}).`);
    this.name = 'RedirectSignInError';
    this.reason = reason;
  }
}

/**
 * A redirect strategy: `oidc-token` with browser sign-in (`oidcSignIn`). The
 * sign-in door owns the cookies, `returnTo` and the order of the callback; the
 * strategy owns the protocol — where to send the browser, and turning the
 * callback into a person through the strategy's OWN `verify` (one path).
 */
export interface RedirectSignIn {
  /** Which strategy this is, recorded on the sign-in. */
  readonly strategy: string;
  /** Whether attempts carry a PKCE verifier. */
  readonly pkce: boolean;
  /** Where to send the browser for this attempt. */
  authorizationUrl(attempt: SignInAttempt, redirectUri: string): Promise<string>;
  /**
   * The callback, already matched to its attempt: exchange the code, check the
   * ID token, and prove the person. Throws {@link RedirectSignInError}.
   */
  complete(callback: URL, attempt: SignInAttempt, redirectUri: string): Promise<SignInAccepted>;
  /** The IdP's end-session URL, when it names one. */
  endSessionUrl?(postLogoutRedirectUri: string): Promise<string | undefined>;
}
