/**
 * hosting/signin/door — the sign-in door: the routes under `/auth` that start
 * and end a sign-in. Nothing it handles is a turn or enters a run's record.
 *
 * Pattern: a plain `(req, res) → handled?` handler an app mounts in front of
 *          its own routes (`nodeHost({ onUnhandled })`), like the app's own
 *          `/auth` routes before it.
 *
 *   GET  /auth/config  → `{ mode: 'password', passwordKind: 'directory' | 'local' }`
 *                        (`passwordKind` when the checker declares its `kind`)
 *   GET  /auth/me      → `{ displayName, accountKey, expiresAt }` or 401
 *   POST /auth/login   → the password sign-in (below)
 *   POST /auth/logout  → end the sign-in, expire the cookie, close its sockets
 *
 * ── `POST /auth/login`, in order ────────────────────────────────────────────
 *  1. The door guard, UNCONDITIONALLY — a login carries no credential, so a
 *     gate keyed on "a credential came in" would never run on it, and a forged
 *     cross-site login signs a victim into the attacker's account (login
 *     forgery). Host, Origin, and `content-type: application/json` (so a form
 *     cannot post it).
 *  2. The body is read by THIS door, capped, and a bad one gets a fixed
 *     sentence: a JSON parser's own message quotes the input, and the input is
 *     a password.
 *  3. Attempt limits (per typed name and per client address), with a growing
 *     delay before any refusal.
 *  4. A sign-in cookie already present is ENDED first.
 *  5. The password is checked. Every wrong credential gets ONE answer.
 *  6. A new sign-in: 256 random bits in the cookie, only their SHA-256 in the
 *     store.
 *  Every answer waits until a minimum time has passed, so "no such user" and
 *  "wrong password" cannot be told apart by how fast they come back.
 *
 * ── The cookie (§5.4) ───────────────────────────────────────────────────────
 * `__Host-Http-af-signin=…; Path=/; HttpOnly; Secure; SameSite=Strict;
 * Max-Age=<lifetime>` — no `Domain`. On a plain-`http` localhost public URL
 * (development only; refused in production) the browser would drop a
 * `__Host-` cookie, so the name is `af-signin` and `Secure` is left off — the
 * banner says so.
 *
 * Every `/auth` response carries `Cache-Control: no-store` and forbids framing,
 * and none carries a CORS header.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { isLoopbackBind, type CrossSiteOptions } from '../doorGuard.js';
import type { DoorIdentity, IdentityVerifier } from '../identityVerification.js';
import { readSignIn, signInKeyOf } from './cookie.js';
import { browserDoorGuard } from './browserGuard.js';
import { checkGate, type CheckGateOptions } from './checkGate.js';
import { PasswordCheckUnreachableError, SignInDoorConfigError } from './errors.js';
import { clientAddress, trustedProxies } from './clientAddress.js';
import { attemptLimiter, type AttemptLimits } from './limits.js';
import { redirectRoutesFor } from './redirectRoutes.js';
import { randomSealKey, type SealKey } from './seal.js';
import { signInSource, type SignIns } from './source.js';
import {
  SIGN_IN_COOKIE,
  SIGN_IN_COOKIE_LOCALHOST,
  type HostSignInOptions,
  type PasswordChecker,
  type PasswordKind,
  type RedirectSignIn,
  type SignInAccepted,
  type SignInStore,
} from './types.js';

export interface SignInDoorOptions {
  /** A password strategy (`localPasswords(…)`) — `POST /auth/login`. Exactly one of this and `redirect`. */
  readonly passwords?: PasswordChecker;
  /**
   * A redirect strategy (`oidcSignIn(…)`) — `GET /auth/login` and
   * `GET /auth/callback`. Exactly one of this and `passwords`.
   */
  readonly redirect?: RedirectSignIn;
  /**
   * Bearer tokens accepted beside the sign-in cookie (scripts, the bench): the
   * strategy's own `verify`. Put into {@link SignInDoor.identity}.
   */
  readonly verify?: IdentityVerifier['verify'];
  /**
   * The key that seals redirect transaction cookies — 32 bytes, shared by
   * replicas (`IDENTITY_COOKIE_KEY_FILE`). Unset: random per process, and the
   * banner says a restart invalidates sign-ins in progress.
   */
  readonly cookieKey?: SealKey;
  /** Where sign-ins are kept (`memorySignIns()`). */
  readonly store: SignInStore;
  /**
   * The URL people open the app at. Decides the cookie: `https` → the
   * `__Host-Http-` cookie with `Secure`; `http` only on a loopback host, and
   * only outside production.
   */
  readonly publicUrl: string;
  /** Is this production? Supplied by the app, never guessed. */
  readonly production: boolean;
  /** The door guard's lists — the SAME ones the host uses. `publicUrl` must pass them. */
  readonly guard?: CrossSiteOptions;
  /** The absolute lifetime of a sign-in, hours. Default 8. */
  readonly hours?: number;
  /** Minutes of inactivity after which a sign-in ends. Default 60 under a password, 30 under a redirect (signing in again is silent there). */
  readonly idleMinutes?: number;
  /** Attempt limits on `POST /auth/login`. */
  readonly limits?: AttemptLimits;
  /** Every login answer waits at least this long, ms. Default 400. */
  readonly minimumResponseMs?: number;
  /**
   * Peers whose `X-Forwarded-For` is believed: the client address is then the
   * rightmost hop that is not one of them. Unset, `X-Forwarded-For` is ignored.
   */
  readonly trustedProxies?: readonly string[];
  /** The route prefix. Default `/auth`. */
  readonly prefix?: string;
  /** The clock, epoch ms. Default `Date.now`. */
  readonly now?: () => number;
  /** The door-wide cap on concurrent password checks (default 4 running, 32 waiting). */
  readonly checks?: CheckGateOptions;
  /** Where a one-time operator warning goes. Default `console.warn`. */
  readonly warn?: (message: string) => void;
}

export interface SignInDoor {
  /** Answer one request if it is under the prefix; resolves whether it was. Never rejects. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** The sign-ins this door starts and ends — what `identity: { signIn }` takes. */
  readonly signIns: SignIns;
  /** The cookie's name. */
  readonly cookieName: string;
  /** What the host takes: `nodeHost({ signIn: door.hostSignIn })`. */
  readonly hostSignIn: HostSignInOptions;
  /** What `standingAgent({ identity })` takes. */
  readonly identity: DoorIdentity;
  /** Lines for the boot banner. No secrets. */
  readonly banner: readonly string[];
}

export { SignInDoorConfigError } from './errors.js';

const DEFAULT_HOURS = 8;
/** The longest a sign-in may last: a week. Browsers cap cookies at 400 days anyway. */
const MAX_HOURS = 168;
const UNAVAILABLE = 'Sign-in is unavailable. Try again shortly.';
/** A sign-in's idle limit by door mode, when `idleMinutes` is not given. */
export const DEFAULT_IDLE_MINUTES = { password: 60, redirect: 30 } as const;
const DEFAULT_MINIMUM_RESPONSE_MS = 400;
const MAX_LOGIN_BODY_BYTES = 8 * 1024;

/** The one answer every wrong credential gets. */
export const WRONG_CREDENTIAL_SENTENCE = 'That username and password did not sign you in.';

export function signInDoor(options: SignInDoorOptions): SignInDoor {
  if (typeof options.production !== 'boolean') {
    throw new SignInDoorConfigError('production', 'production is true or false — the app decides');
  }
  const cookie = cookieFor(options.publicUrl, options.production);
  const prefix = options.prefix ?? '/auth';
  const now = options.now ?? Date.now;
  const hours = bounded(options.hours ?? DEFAULT_HOURS, 'hours', MAX_HOURS);
  const mode = modeOf(options);
  const config = configAnswerOf(mode, options.passwords);
  const idleMinutes = bounded(
    options.idleMinutes ?? DEFAULT_IDLE_MINUTES[mode],
    'idleMinutes',
    MAX_HOURS * 60,
  );
  const minimumMs = options.minimumResponseMs ?? DEFAULT_MINIMUM_RESPONSE_MS;
  if (!Number.isFinite(minimumMs) || minimumMs < 0 || minimumMs > 10_000) {
    throw new SignInDoorConfigError('minimumResponseMs', 'minimumResponseMs is 0 to 10 000 ms');
  }
  const guard = browserDoorGuard('sign-in', options.guard, cookie.url, !cookie.secure);
  const limiter = attemptLimiter(options.limits);
  const gate = checkGate(options.checks);
  const signIns = signInSource({ store: options.store, idleMinutes, now });
  const trusted = trustedProxies(options.trustedProxies);
  const warn = options.warn ?? ((message: string) => console.warn(message));
  let warnedForwarded = false;
  const noteForwarded = (): void => {
    if (warnedForwarded) return;
    warnedForwarded = true;
    warn(
      `[hosting] signInDoor: sign-in requests carry X-Forwarded-For but trustedProxies is not ` +
        `set, so every person behind that proxy counts as ONE client address — one shared ` +
        `(delay-only) address budget. Set trustedProxies to the proxy's address or range.`,
    );
  };
  const identity: DoorIdentity =
    options.verify === undefined
      ? { signIn: signIns }
      : { verify: options.verify, signIn: signIns };
  const sealKey = options.cookieKey ?? randomSealKey();

  const reply = (res: ServerResponse, status: number, body: unknown, extra: Headers = {}): void => {
    if (res.headersSent) return;
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json', ...extra });
    res.end(JSON.stringify(body));
  };

  /** A new sign-in for a proven person: 256 random bits out, only their SHA-256 kept. */
  const startSignIn = async (
    accepted: SignInAccepted,
    strategy: string,
  ): Promise<{ setCookie: string; body: Record<string, string> }> => {
    const value = randomBytes(32).toString('base64url');
    const at = now();
    const expiresAt = at + hours * 3_600_000;
    await options.store.create({
      key: signInKeyOf(value),
      identity: accepted.identity,
      ...(accepted.displayName !== undefined && { displayName: accepted.displayName }),
      strategy,
      startedAt: at,
      expiresAt,
      lastSeenAt: at,
    });
    return {
      setCookie: cookie.issue(value, hours * 3600),
      body: {
        displayName: accepted.displayName ?? accepted.identity.userId,
        accountKey: accountKeyOf(accepted.identity.userId),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  };

  /** End the sign-in a request carries, if any; resolves whether there was one. */
  const endPresent = async (req: IncomingMessage): Promise<boolean> => {
    const present = readSignIn(req.headers, cookie.name).key;
    if (present === undefined) return false;
    await signIns.end(present);
    return true;
  };

  const login = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const started = now();
    // EVERY answer — refused, wrong, right, or a store that failed — waits for
    // the minimum time, so no outcome can be told apart by how fast it came.
    const answer = async (status: number, body: unknown, extra: Headers = {}): Promise<void> => {
      await sleep(started + minimumMs - now());
      reply(res, status, body, extra);
    };
    const unavailable = (extra: Headers = {}) =>
      answer(503, { error: UNAVAILABLE }, { 'retry-after': '5', ...extra });
    const read = await readLoginBody(req);
    if (read.kind === 'refused') return answer(read.status, { error: read.sentence });
    const address = clientAddress(req, trusted, noteForwarded);
    const passwords = options.passwords as PasswordChecker;
    // Counted as it STARTS, before the slow check (review idI34 B-1), under the
    // ACCOUNT the checker says the name reaches — `alice`, `ALICE` and
    // `alice@corp.example` are one budget and one check in flight (idI57 B-1).
    const verdict = limiter.begin(budgetKeyOf(passwords, read.username), address, now());
    if (verdict.kind === 'refuse') {
      return answer(
        429,
        { error: 'Too many sign-in attempts. Wait, then try again.' },
        { 'retry-after': String(verdict.retryAfterSeconds) },
      );
    }
    if (verdict.kind === 'busy') return unavailable();
    const { ticket } = verdict;
    await sleep(verdict.delayMs);
    const expire: Headers = {};
    let accepted: SignInAccepted | undefined;
    try {
      if (await endPresent(req)) expire['set-cookie'] = cookie.expired();
      const ran = await gate.run(() => passwords.check(read.username, read.password));
      if (ran === undefined) {
        limiter.abandoned(ticket);
        return await unavailable(expire);
      }
      accepted = ran.value;
    } catch (error) {
      // Un-counted ONLY when the password never left this process; a check
      // that failed after it was sent (a bind that timed out) may have been
      // charged by the directory, so it stays counted (review idI57 S-6).
      if (error instanceof PasswordCheckUnreachableError) limiter.abandoned(ticket);
      else limiter.failed(ticket, now());
      return unavailable(expire);
    }
    if (accepted === undefined) {
      limiter.failed(ticket, now());
      return answer(401, { error: WRONG_CREDENTIAL_SENTENCE }, expire);
    }
    limiter.succeeded(ticket);
    try {
      const signedIn = await startSignIn(accepted, passwords.strategy);
      return await answer(200, signedIn.body, { 'set-cookie': signedIn.setCookie });
    } catch {
      // A store that is full or down: the same 503, after the same minimum
      // time — never an oracle for "that password was right".
      return unavailable(expire);
    }
  };

  const redirectRoutes =
    options.redirect === undefined
      ? undefined
      : redirectRoutesFor({
          strategy: options.redirect,
          publicUrl: cookie.url,
          prefix,
          cookie,
          sealKey,
          now,
          warn,
          endPresent,
          startSignIn,
        });

  const me = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const key = readSignIn(req.headers, cookie.name).key;
    const who = key === undefined ? undefined : await signIns.identify(key);
    const row = key === undefined || who === undefined ? undefined : await options.store.find(key);
    if (row === undefined) return reply(res, 401, { error: 'Not signed in.' });
    return reply(res, 200, {
      displayName: row.displayName ?? row.identity.userId,
      accountKey: accountKeyOf(row.identity.userId),
      expiresAt: new Date(row.expiresAt).toISOString(),
    });
  };

  const logout = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    await endPresent(req);
    const next = (await redirectRoutes?.logoutNext()) ?? '/';
    return reply(res, 200, { next }, { 'set-cookie': cookie.expired() });
  };

  const route = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    const refusal = guard.check(req);
    if (refusal !== undefined)
      return reply(res, refusal.status, { error: refusal.message, code: refusal.code });
    const method = (req.method ?? 'GET').toUpperCase();
    const routes = ROUTES[mode];
    const want = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : undefined;
    if (want === undefined) return reply(res, 404, { error: 'No such sign-in route.' });
    if (method !== want) {
      return reply(res, 405, { error: `Use ${want}.` }, { allow: want });
    }
    if (path === 'config') return reply(res, 200, config);
    if (path === 'me') return me(req, res);
    if (path === 'logout') return logout(req, res);
    if (redirectRoutes !== undefined) {
      if (path === 'login') return redirectRoutes.login(req, res);
      return redirectRoutes.callback(req, res);
    }
    return login(req, res);
  };

  return {
    signIns,
    cookieName: cookie.name,
    identity,
    hostSignIn: { cookieName: cookie.name, identity },
    banner: [
      `identity: sign-in door ${prefix}/{config,me,login,logout}; cookie ${cookie.name}` +
        (cookie.secure ? ' (Secure, HttpOnly, SameSite=Strict)' : ''),
      ...(cookie.secure
        ? []
        : [
            `identity: WARNING ${cookie.url.origin} is plain http on this machine: the cookie is ` +
              `'${SIGN_IN_COOKIE_LOCALHOST}' without Secure or the __Host- prefix (development only; production refuses it). ` +
              `Cookies do not isolate by port, so any other app on this machine's loopback names can set this door's cookies`,
          ]),
      `identity: sign-ins last ${hours} h, ${idleMinutes} min idle`,
      ...(mode === 'redirect'
        ? [
            `identity: browser sign-in by redirect (${prefix}/login → the IdP → ${prefix}/callback); PKCE ${
              options.redirect?.pkce === true ? 'on' : 'OFF (AD FS 2016)'
            } — PENDING INDEPENDENT REVIEW before a company install`,
            options.cookieKey === undefined
              ? 'identity: WARNING no IDENTITY_COOKIE_KEY_FILE: sign-ins in progress are sealed with a per-process key, so a restart or another replica breaks them'
              : 'identity: sign-ins in progress are sealed with IDENTITY_COOKIE_KEY_FILE',
          ]
        : []),
      'identity: sign-ins and attempt budgets are per process. Run one replica, or pin each ' +
        'browser to one replica (sticky sessions), or configure a shared sign-in store.',
    ],
    async handle(req, res) {
      const path = (req.url ?? '').split('?')[0] ?? '';
      if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
      try {
        await route(req, res, path.slice(prefix.length + 1));
      } catch {
        // A store that threw, a socket that went away: this request's failure,
        // never the process's — and never the error's own words.
        reply(res, 503, { error: 'Sign-in is unavailable. Try again shortly.' });
      }
      return true;
    },
  };
}

// ─── Pieces ──────────────────────────────────────────────────────────

type Headers = Record<string, string | string[]>;

const ROUTES: Readonly<Record<'password' | 'redirect', Readonly<Record<string, string>>>> = {
  password: { config: 'GET', me: 'GET', login: 'POST', logout: 'POST' },
  redirect: { config: 'GET', me: 'GET', login: 'GET', callback: 'GET', logout: 'POST' },
};

function modeOf(options: SignInDoorOptions): 'password' | 'redirect' {
  const both = options.passwords !== undefined && options.redirect !== undefined;
  const neither = options.passwords === undefined && options.redirect === undefined;
  if (both || neither) {
    throw new TypeError(
      `[hosting] signInDoor takes exactly one strategy: 'passwords' (a password form) or ` +
        `'redirect' (an identity provider's sign-in page).`,
    );
  }
  return options.passwords !== undefined ? 'password' : 'redirect';
}

/** What `GET /auth/config` may say a password door takes. */
const PASSWORD_KINDS: readonly PasswordKind[] = ['directory', 'local'];

/**
 * `GET /auth/config`'s answer, fixed at construction: the mode, and on a
 * password door the checker's declared `kind` as `passwordKind` — so a page
 * can label its form. A checker that declares none adds nothing (never a
 * guess); one that declares a word outside the vocabulary is refused here,
 * because the page branches on it.
 */
function configAnswerOf(
  mode: 'password' | 'redirect',
  passwords: PasswordChecker | undefined,
): Readonly<{ mode: 'password' | 'redirect'; passwordKind?: PasswordKind }> {
  const kind = passwords?.kind;
  if (mode !== 'password' || kind === undefined) return { mode };
  if (!PASSWORD_KINDS.includes(kind)) {
    throw new SignInDoorConfigError(
      'passwords',
      `passwords.kind is 'directory' or 'local' (got ${JSON.stringify(kind)})`,
    );
  }
  return { mode, passwordKind: kind };
}

const SECURITY_HEADERS: Readonly<Headers> = {
  'cache-control': 'no-store',
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/** A 128-bit key for the page's caches: one per person, not the id itself. */
export function accountKeyOf(userId: string): string {
  return createHash('sha256')
    .update(`af-account:${userId}`, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export interface CookieShape {
  readonly name: string;
  readonly secure: boolean;
  readonly url: URL;
  issue(value: string, maxAgeSeconds: number): string;
  expired(): string;
  /** The per-attempt transaction cookie's name. */
  txName(attempt: string): string;
  /** A transaction cookie: `SameSite=Lax` (it must come back on the IdP's redirect), 10 minutes. */
  issueTx(attempt: string, sealed: string): string;
  expireTx(attempt: string): string;
}

function cookieFor(publicUrl: string, production: boolean): CookieShape {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new SignInDoorConfigError('publicUrl', `publicUrl '${publicUrl}' is not an absolute URL`);
  }
  // The door's routes, its cookies (`Path=/`, `__Host-`) and the callback URL
  // all live at the origin's root, so an app published under a path would
  // send the IdP a redirect URI it never registered (review idI57 N-5).
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new SignInDoorConfigError(
      'publicUrl',
      `publicUrl '${publicUrl}' has a path; the sign-in door runs at the origin's root, so give ` +
        `the origin alone (${url.origin})`,
    );
  }
  const secure = url.protocol === 'https:';
  if (!secure) {
    if (url.protocol !== 'http:' || !isLoopbackBind(url.hostname)) {
      throw new SignInDoorConfigError(
        'publicUrl',
        `publicUrl '${publicUrl}' must be https (plain http is accepted only on this machine's ` +
          `loopback names, for development)`,
      );
    }
    if (production) {
      throw new SignInDoorConfigError(
        'publicUrl',
        `publicUrl '${publicUrl}' is plain http, and this is production. Without https the ` +
          `browser drops the Secure, __Host- sign-in cookie's protections`,
      );
    }
  }
  const name = secure ? SIGN_IN_COOKIE : SIGN_IN_COOKIE_LOCALHOST;
  const attrs = `Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict`;
  return {
    name,
    secure,
    url,
    issue: (value, maxAge) => `${name}=${value}; ${attrs}; Max-Age=${Math.floor(maxAge)}`,
    expired: () => `${name}=; ${attrs}; Max-Age=0`,
    txName: (attempt) => `${name}-tx-${attempt}`,
    issueTx: (attempt, sealed) =>
      `${name}-tx-${attempt}=${sealed}; Path=/; HttpOnly;${
        secure ? ' Secure;' : ''
      } SameSite=Lax; Max-Age=600`,
    expireTx: (attempt) =>
      `${name}-tx-${attempt}=; Path=/; HttpOnly;${
        secure ? ' Secure;' : ''
      } SameSite=Lax; Max-Age=0`,
  };
}

type LoginRead =
  | { readonly kind: 'ok'; readonly username: string; readonly password: string }
  | { readonly kind: 'refused'; readonly status: number; readonly sentence: string };

const BAD_BODY = 'The sign-in request must be a JSON object: { "username": "…", "password": "…" }.';

/** Read `{ username, password }`. Never quotes the body in any answer. */
async function readLoginBody(req: IncomingMessage): Promise<LoginRead> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > MAX_LOGIN_BODY_BYTES) {
    req.resume();
    return { kind: 'refused', status: 413, sentence: 'The sign-in request is too large.' };
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > MAX_LOGIN_BODY_BYTES) {
      return { kind: 'refused', status: 413, sentence: 'The sign-in request is too large.' };
    }
    chunks.push(buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { kind: 'refused', status: 400, sentence: BAD_BODY };
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { kind: 'refused', status: 400, sentence: BAD_BODY };
  }
  // One spelling per name: `José` typed as NFC and as NFD is one person.
  const name = username.trim().normalize('NFC');
  // An empty password is refused before any check (RFC 4513 §6.3.1's advice,
  // kept for every password strategy): it is a malformed request, not a guess.
  if (name.length === 0 || password.length === 0) {
    return {
      kind: 'refused',
      status: 400,
      sentence: 'A username and a password are both required.',
    };
  }
  if (name.length > 256 || password.length > 1024) {
    return { kind: 'refused', status: 400, sentence: BAD_BODY };
  }
  // A control character is never part of a password a person typed, and a
  // directory may cut the password at one (Samba signs `right\0junk` in —
  // review idI57 N-7). Refused as malformed, before any check.
  if (CONTROL_CHARACTER.test(password) || CONTROL_CHARACTER.test(name)) {
    return { kind: 'refused', status: 400, sentence: BAD_BODY };
  }
  return { kind: 'ok', username: name, password };
}

const CONTROL_CHARACTER = /\p{Cc}/u;

/** The key a typed name's attempts are counted under — the checker's, when it names one. */
function budgetKeyOf(passwords: PasswordChecker, typed: string): string {
  return passwords.budgetKey?.(typed) ?? typed;
}

function bounded(value: number, name: string, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new SignInDoorConfigError(name, `${name} must be more than 0 and at most ${max}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
