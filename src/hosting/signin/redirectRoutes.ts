/**
 * hosting/signin/redirectRoutes — the sign-in door's redirect half:
 * `GET /auth/login` and `GET /auth/callback` (design §5.2). PENDING
 * INDEPENDENT REVIEW before a company install.
 *
 * `GET /auth/login`
 *   Check `returnTo` (§5.5). Make `state`, `nonce` and (unless PKCE is off) a
 *   PKCE verifier. SEAL them, with `returnTo` and the time, into this
 *   attempt's transaction cookie. Nothing is written on the server. Redirect
 *   to the identity provider.
 *
 * `GET /auth/callback`, in this order:
 *   1. Open the transaction cookie named by `state` — sealed by this server,
 *      for this attempt, less than 10 minutes old — and compare `state`.
 *   2. Clear the transaction cookie, WHATEVER the outcome: `state` is single use.
 *   3. The strategy exchanges the code (client authentication + the PKCE
 *      verifier), checks the ID token (`iss`, `aud`, `nonce`, `exp`) and runs
 *      its OWN `verify` on the access token — the person test included.
 *   4. End any sign-in the browser already carries; create the new one.
 *   5. 303 to `returnTo`, with `Referrer-Policy: no-referrer` so the code in
 *      this URL does not leak onward.
 *   A failure is a 303 to `/?signin_error=<code>`: a fixed reason code, never
 *   the identity provider's text.
 *
 * Two `GET` routes change state, deliberately: the login sets a cookie and the
 * callback creates a sign-in. Both are safe — the callback needs the sealed
 * cookie issued to THIS browser, a matching `state`, and a single-use code
 * bound to the PKCE verifier and nonce.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { safeReturnTo } from './returnTo.js';
import { seal, unseal, type SealKey } from './seal.js';
import {
  RedirectSignInError,
  type RedirectSignIn,
  type SignInAccepted,
  type SignInAttempt,
} from './types.js';

/** What the door hands the redirect half. */
export interface RedirectContext {
  readonly strategy: RedirectSignIn;
  readonly publicUrl: URL;
  readonly prefix: string;
  readonly cookie: {
    txName(attempt: string): string;
    issueTx(attempt: string, sealed: string): string;
    expireTx(attempt: string): string;
  };
  readonly sealKey: SealKey;
  readonly now: () => number;
  endPresent(req: IncomingMessage): Promise<boolean>;
  startSignIn(
    accepted: SignInAccepted,
    strategy: string,
  ): Promise<{ setCookie: string; body: Record<string, string> }>;
}

export interface RedirectRoutes {
  login(req: IncomingMessage, res: ServerResponse): Promise<void>;
  callback(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Where the page goes after sign-out: the IdP's end-session URL, or `/`. */
  logoutNext(): Promise<string>;
}

/** The sealed transaction. Short keys: it rides in a cookie. */
interface Transaction {
  readonly s: string; // state
  readonly n: string; // nonce
  readonly v?: string; // PKCE verifier
  readonly r: string; // returnTo, already checked
  readonly t: number; // sealed at, epoch ms
}

const TRANSACTION_MS = 600_000;
const ATTEMPT = /^[A-Za-z0-9_-]{16}$/;

export function redirectRoutesFor(ctx: RedirectContext): RedirectRoutes {
  const redirectUri = `${ctx.publicUrl.origin}${ctx.prefix}/callback`;

  const go = (res: ServerResponse, status: number, location: string, cookies: string[]): void => {
    if (res.headersSent) return;
    res.writeHead(status, {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "frame-ancestors 'none'",
      ...(cookies.length > 0 && { 'set-cookie': cookies }),
    });
    res.end();
  };

  const failed = (res: ServerResponse, reason: string, cookies: string[]): void =>
    go(res, 303, `/?signin_error=${encodeURIComponent(reason)}`, cookies);

  return {
    async login(req, res) {
      const url = new URL(req.url ?? '/', ctx.publicUrl.origin);
      const returnTo = safeReturnTo(url.searchParams.get('returnTo'), ctx.publicUrl);
      const attempt = randomBytes(12).toString('base64url');
      const secrets: SignInAttempt = {
        state: `${attempt}.${randomBytes(24).toString('base64url')}`,
        nonce: randomBytes(24).toString('base64url'),
        ...(ctx.strategy.pkce && { codeVerifier: randomBytes(32).toString('base64url') }),
      };
      let location: string;
      try {
        location = await ctx.strategy.authorizationUrl(secrets, redirectUri);
      } catch {
        return failed(res, 'unavailable', []);
      }
      const transaction: Transaction = {
        s: secrets.state,
        n: secrets.nonce,
        ...(secrets.codeVerifier !== undefined && { v: secrets.codeVerifier }),
        r: returnTo,
        t: ctx.now(),
      };
      const sealed = seal(ctx.sealKey, ctx.cookie.txName(attempt), transaction);
      return go(res, 302, location, [ctx.cookie.issueTx(attempt, sealed)]);
    },

    async callback(req, res) {
      const url = new URL(req.url ?? '/', ctx.publicUrl.origin);
      const state = url.searchParams.get('state') ?? '';
      const attempt = state.split('.')[0] ?? '';
      if (!ATTEMPT.test(attempt)) return failed(res, 'state', []);
      // Cleared whatever happens next: a `state` is single use.
      const clear = [ctx.cookie.expireTx(attempt)];
      const transaction = openTransaction(ctx, req, attempt);
      if (transaction === undefined || !sameText(transaction.s, state)) {
        return failed(res, 'state', clear);
      }
      const secrets: SignInAttempt = {
        state: transaction.s,
        nonce: transaction.n,
        ...(transaction.v !== undefined && { codeVerifier: transaction.v }),
      };
      let accepted: SignInAccepted;
      try {
        accepted = await ctx.strategy.complete(url, secrets, redirectUri);
      } catch (err) {
        return failed(
          res,
          err instanceof RedirectSignInError ? err.reason : 'exchange-failed',
          clear,
        );
      }
      await ctx.endPresent(req);
      const started = await ctx.startSignIn(accepted, ctx.strategy.strategy);
      return go(res, 303, transaction.r, [...clear, started.setCookie]);
    },

    async logoutNext() {
      try {
        return (await ctx.strategy.endSessionUrl?.(`${ctx.publicUrl.origin}/`)) ?? '/';
      } catch {
        return '/';
      }
    },
  };
}

/** The attempt's transaction, if this server sealed it for this attempt within 10 minutes. */
function openTransaction(
  ctx: RedirectContext,
  req: IncomingMessage,
  attempt: string,
): Transaction | undefined {
  const name = ctx.cookie.txName(attempt);
  const value = cookieValue(req.headers.cookie, name);
  if (value === undefined) return undefined;
  const opened = unseal(ctx.sealKey, name, value) as Partial<Transaction> | undefined;
  if (
    opened === undefined ||
    opened === null ||
    typeof opened.s !== 'string' ||
    typeof opened.n !== 'string' ||
    typeof opened.r !== 'string' ||
    typeof opened.t !== 'number' ||
    (opened.v !== undefined && typeof opened.v !== 'string')
  ) {
    return undefined;
  }
  const age = ctx.now() - opened.t;
  if (age < 0 || age > TRANSACTION_MS) return undefined;
  return opened as Transaction;
}

/** The one value of a named cookie; two of the same name name nothing. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  const found = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return found.length === 1 ? found[0] : undefined;
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
