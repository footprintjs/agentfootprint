/**
 * hosting/signin/door — the sign-in door: the routes under `/auth` that start
 * and end a sign-in. Nothing it handles is a turn or enters a run's record.
 *
 * Pattern: a plain `(req, res) → handled?` handler an app mounts in front of
 *          its own routes (`nodeHost({ onUnhandled })`), like the app's own
 *          `/auth` routes before it.
 *
 *   GET  /auth/config  → `{ mode: 'password' }`
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

import { doorGuard, isLoopbackBind, type CrossSiteOptions, type DoorGuard } from '../doorGuard.js';
import type { IdentityVerificationOptions, IdentityVerifier } from '../identityVerification.js';
import { readSignIn, signInKeyOf } from './cookie.js';
import { attemptLimiter, type AttemptLimits } from './limits.js';
import { redirectRoutesFor } from './redirectRoutes.js';
import { randomSealKey, type SealKey } from './seal.js';
import { signInSource, type SignIns } from './source.js';
import {
  SIGN_IN_COOKIE,
  SIGN_IN_COOKIE_LOCALHOST,
  type HostSignInOptions,
  type PasswordChecker,
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
  readonly identity: IdentityVerificationOptions;
  /** Lines for the boot banner. No secrets. */
  readonly banner: readonly string[];
}

const DEFAULT_HOURS = 8;
const DEFAULT_IDLE_MINUTES = { password: 60, redirect: 30 } as const;
const DEFAULT_MINIMUM_RESPONSE_MS = 400;
const MAX_LOGIN_BODY_BYTES = 8 * 1024;

/** The one answer every wrong credential gets. */
export const WRONG_CREDENTIAL_SENTENCE = 'That username and password did not sign you in.';

export function signInDoor(options: SignInDoorOptions): SignInDoor {
  const cookie = cookieFor(options.publicUrl, options.production);
  const prefix = options.prefix ?? '/auth';
  const now = options.now ?? Date.now;
  const hours = positive(options.hours ?? DEFAULT_HOURS, 'hours');
  const mode = modeOf(options);
  const idleMinutes = positive(options.idleMinutes ?? DEFAULT_IDLE_MINUTES[mode], 'idleMinutes');
  const minimumMs = options.minimumResponseMs ?? DEFAULT_MINIMUM_RESPONSE_MS;
  const guard = guardFor(options.guard, cookie.url);
  const limiter = attemptLimiter(options.limits);
  const signIns = signInSource({ store: options.store, idleMinutes, now });
  const trusted = new Set(options.trustedProxies ?? []);
  const identity: IdentityVerificationOptions =
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
    const answer = async (status: number, body: unknown, extra: Headers = {}): Promise<void> => {
      await sleep(started + minimumMs - now());
      reply(res, status, body, extra);
    };
    const read = await readLoginBody(req);
    if (read.kind === 'refused') return answer(read.status, { error: read.sentence });
    const address = clientAddress(req, trusted);
    const verdict = limiter.before(read.username, address, now());
    if (verdict.kind === 'refuse') {
      return answer(
        429,
        { error: 'Too many sign-in attempts. Wait, then try again.' },
        { 'retry-after': String(verdict.retryAfterSeconds) },
      );
    }
    await sleep(verdict.delayMs);
    const expire: Headers = {};
    if (await endPresent(req)) expire['set-cookie'] = cookie.expired();
    const passwords = options.passwords as PasswordChecker;
    let accepted;
    try {
      accepted = await passwords.check(read.username, read.password);
    } catch {
      return answer(503, { error: 'Sign-in is unavailable. Try again shortly.' }, expire);
    }
    if (accepted === undefined) {
      limiter.failed(read.username, address, now());
      return answer(401, { error: WRONG_CREDENTIAL_SENTENCE }, expire);
    }
    limiter.succeeded(read.username);
    const started2 = await startSignIn(accepted, passwords.strategy);
    return answer(200, started2.body, { 'set-cookie': started2.setCookie });
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
    const want = ROUTES[mode][path];
    if (want === undefined) return reply(res, 404, { error: 'No such sign-in route.' });
    if (method !== want) {
      return reply(res, 405, { error: `Use ${want}.` }, { allow: want });
    }
    if (path === 'config') return reply(res, 200, { mode });
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
              `'${SIGN_IN_COOKIE_LOCALHOST}' without Secure or the __Host- prefix (development only; production refuses it)`,
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
    throw new TypeError(`[hosting] signInDoor: publicUrl '${publicUrl}' is not an absolute URL.`);
  }
  const secure = url.protocol === 'https:';
  if (!secure) {
    if (url.protocol !== 'http:' || !isLoopbackBind(url.hostname)) {
      throw new TypeError(
        `[hosting] signInDoor: publicUrl '${publicUrl}' must be https (plain http is accepted ` +
          `only on this machine's loopback names, for development).`,
      );
    }
    if (production) {
      throw new TypeError(
        `[hosting] signInDoor: publicUrl '${publicUrl}' is plain http, and this is production. ` +
          `Without https the browser drops the Secure, __Host- sign-in cookie's protections.`,
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

/**
 * The guard, built from the host's own lists (H4: one source). Refused at
 * construction: no `allowedHosts` for a public URL that is not loopback (H1),
 * `'any'` for either list (a browser door), and a public URL its own lists
 * would refuse.
 */
function guardFor(lists: CrossSiteOptions | undefined, url: URL): DoorGuard {
  if (lists?.allowedHosts === 'any' || lists?.allowedOrigins === 'any') {
    throw new TypeError(
      `[hosting] signInDoor: allowedHosts/allowedOrigins 'any' says no browser reaches this ` +
        `door, and a sign-in door is for browsers. List the names people use.`,
    );
  }
  if (lists?.allowedHosts === undefined && !isLoopbackBind(url.hostname)) {
    throw new TypeError(
      `[hosting] signInDoor needs the door hardening's allowedHosts (the same list the host ` +
        `uses): a sign-in cookie rides along on every forged request, so the door must refuse ` +
        `other Host names and origins before identity is consulted.`,
    );
  }
  const guard = doorGuard({
    name: 'sign-in',
    ...(lists?.allowedHosts === undefined && { bindHost: url.hostname }),
    ...(lists?.allowedHosts !== undefined && { allowedHosts: lists.allowedHosts }),
    ...(lists?.allowedOrigins !== undefined && { allowedOrigins: lists.allowedOrigins }),
  });
  const probe = guard.check({
    method: 'POST',
    headers: { host: url.host, origin: url.origin, 'content-type': 'application/json' },
  });
  if (probe !== undefined) {
    throw new TypeError(
      `[hosting] signInDoor: the public URL ${url.origin} is refused by the door's own lists ` +
        `(${probe.code}). Add its host to allowedHosts (and its origin to allowedOrigins, when set).`,
    );
  }
  return guard;
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
  const name = username.trim();
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
  return { kind: 'ok', username: name, password };
}

/** The socket's address, or the rightmost untrusted `X-Forwarded-For` hop behind a trusted proxy. */
function clientAddress(req: IncomingMessage, trusted: ReadonlySet<string>): string {
  const peer = normaliseAddress(req.socket?.remoteAddress ?? 'unknown');
  if (!trusted.has(peer)) return peer;
  const header = req.headers['x-forwarded-for'];
  const hops = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',')
    .map((h) => normaliseAddress(h.trim()))
    .filter((h) => h.length > 0);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i] as string;
    if (!trusted.has(hop)) return hop;
  }
  return peer;
}

function normaliseAddress(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`[hosting] signInDoor: ${name} must be a positive number.`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
