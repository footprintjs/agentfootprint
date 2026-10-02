/**
 * hosting/signin/audit — the sign-in door's audit trail: one record per
 * sign-in outcome, handed to a sink the app owns AND written as one log line.
 *
 *   const door = signInDoor({
 *     passwords, store, publicUrl, production,
 *     onAudit: (record) => securityLog.write(record),  // typed, optional
 *     // log: (line) => logger.info(line),            // default: console.info
 *   });
 *
 * ── Why a door option and not a typed event ─────────────────────────────────
 * Every typed event carries `EventMeta`, whose `runId` and `runtimeStageId`
 * are REQUIRED, and is emitted by one agent's dispatcher. A sign-in is never a
 * run: no agent exists when a person types their password. The library's own
 * answer for door facts that happen before any run is a SINK at the door —
 * `standingAgent({ onIngressDecision })` (ingressRecord.ts) — and this is the
 * same shape, owned by the one place every sign-in outcome is decided.
 *
 * ── What a record carries, and what it never does ───────────────────────────
 * Classes and identifiers only: the outcome, a reason class, the strategy, the
 * ACCOUNT the typed name reaches (the checker's `budgetKey` — `alice`,
 * `CORP\alice` and `alice@corp.example` are all `alice`), the id the strategy
 * PROVED, the client address after trusted-proxy resolution, the time, and on
 * `directory-password` the AD sub-code with its name. Never the password,
 * never a cookie or its key, never a token, never an error's message.
 *
 * ── It is not the audit hash chain ──────────────────────────────────────────
 * Like the ingress record it is a STREAM into your own sink, not hashed, not
 * sequenced and not verifiable by `verifyAuditBundle`. Chain it in your own
 * store if you need tamper evidence.
 */

/**
 * How a sign-in ended. The first four are attempts at `/auth/login` (and a
 * redirect callback); the last two are a sign-in ENDING.
 *
 *  - `'signed-in'` — a sign-in was created (200 / the callback's 303).
 *  - `'refused'` — the credential or the request was refused (401, 400, the
 *    door guard, a redirect callback that failed on the browser's side).
 *  - `'limited'` — an attempt limit refused it before any check (429). The
 *    directory was NOT contacted.
 *  - `'unavailable'` — the door could not answer (503): the directory or the
 *    identity provider unreachable, the checks full, the store down.
 *  - `'signed-out'` — `POST /auth/logout` ended a live sign-in.
 *  - `'expired'` — a sign-in was found past its lifetime or idle limit and
 *    ended. Recorded when it is FOUND (the next request carrying it), not at
 *    the instant it lapsed; a sign-in never presented again is not recorded.
 *  A sign-in's END is filed once, however many requests race on it.
 */
export type SignInOutcome =
  | 'signed-in'
  | 'refused'
  | 'limited'
  | 'unavailable'
  | 'signed-out'
  | 'expired';

/**
 * Why a password check refused a credential — what a {@link PasswordChecker}
 * may say through its `note` (types.ts). The person never sees it; it travels
 * to the operator's record only.
 *
 *  - `'wrong-credential'` — the backend refused the name and password
 *    (`directory-password`: the bind; the AD sub-code says more).
 *  - `'unknown-account'` — no such name (`local-password`; a directory cannot
 *    tell this apart from a wrong password without a service account).
 *  - `'name-refused'` — the typed name never reached the backend (it fails the
 *    name rule, or names another domain).
 *  - `'malformed-request'` — an empty password or a control character.
 *  - `'account-unresolved'` — the bind worked but Who-am-I did not name an
 *    account of this domain, or not EXACTLY one entry matched it.
 *  - `'not-in-group'` — the person is not in the required group.
 */
export type PasswordRefusalReason =
  | 'wrong-credential'
  | 'unknown-account'
  | 'name-refused'
  | 'malformed-request'
  | 'account-unresolved'
  | 'not-in-group';

/**
 * The reason class beside an {@link SignInOutcome} — the field a dashboard
 * groups by. Every value belongs to one outcome:
 *
 *  - `'signed-in'`: `'accepted'`.
 *  - `'refused'`: every {@link PasswordRefusalReason}; `'cross-site'` (the door
 *    guard refused a login: a foreign Origin, a Host not configured, a form
 *    post); and a redirect callback's `RedirectFailure` codes —
 *    `'state-mismatch'`, `'idp-error'`, `'exchange-failed'`,
 *    `'id-token-refused'`, `'not-a-person'`.
 *  - `'limited'`: `'name-budget'` (the account's attempt budget is spent),
 *    `'name-in-flight'` (a check for the account is still running),
 *    `'address-budget'` (the opt-in hard per-address budget is spent).
 *  - `'unavailable'`: `'backend-unreachable'` (the password never left this
 *    process), `'check-failed'` (it failed after it was sent — counted),
 *    `'checks-busy'` (the door-wide check cap is full), `'limits-full'` (the
 *    attempt counters are full of penalties), `'store-failed'`,
 *    `'idp-unavailable'`.
 *  - `'signed-out'`: `'logout'`. `'expired'`: `'lifetime'`, `'idle'`.
 */
export type SignInReason =
  | 'accepted'
  | PasswordRefusalReason
  | 'cross-site'
  | 'state-mismatch'
  | 'idp-error'
  | 'exchange-failed'
  | 'id-token-refused'
  | 'not-a-person'
  | 'name-budget'
  | 'name-in-flight'
  | 'address-budget'
  | 'backend-unreachable'
  | 'check-failed'
  | 'checks-busy'
  | 'limits-full'
  | 'store-failed'
  | 'idp-unavailable'
  | 'logout'
  | 'lifetime'
  | 'idle';

/**
 * What an Active Directory bind refusal's sub-code (`data 52e` in the LDAP
 * error) means, as a word. Anything not in the list — `525` (no such user),
 * `530`/`531` (logon hours, workstation), a code a later AD invents — is
 * `'unknown'`, and the raw code still travels beside it.
 *
 * AD reports most of these only when the password was RIGHT (an expired or
 * disabled account with a wrong password is `52e`); `775` (locked) comes back
 * whatever the password.
 */
export type AdSubCodeName =
  | 'bad-password'
  | 'locked'
  | 'password-expired'
  | 'must-change'
  | 'disabled'
  | 'account-expired'
  | 'unknown';

/** What a password check may tell the door about a refusal — never a secret. */
export interface PasswordCheckDetail {
  readonly reason: PasswordRefusalReason;
  /** `directory-password`: AD's bind sub-code, lower-case hex (`'52e'`). */
  readonly adSubCode?: string;
  /** `directory-password`: what that sub-code means. */
  readonly adSubCodeName?: AdSubCodeName;
}

/**
 * One sign-in outcome, as plain data. Every field is a class of what happened
 * or an identifier the operator needs; nothing here is a secret and nothing is
 * a message.
 */
export interface SignInAuditRecord {
  /** When the door decided, epoch ms (the door's `now`). */
  readonly at: number;
  readonly outcome: SignInOutcome;
  readonly reason: SignInReason;
  /** Which strategy: `directory-password`, `local-password`, `oidc-token`, … */
  readonly strategy: string;
  /**
   * The ACCOUNT the typed name reaches — the checker's `budgetKey`
   * (`directory-password`: lower-cased, any `DOMAIN\` and `@domain` removed,
   * so `user`, `DOMAIN\user` and `user@dns.domain` are all the
   * sAMAccountName). Absent when no name was read (a redirect sign-in, a body
   * that did not parse, a request the door guard refused).
   */
  readonly account?: string;
  /** The id the strategy PROVED — on `signed-in`, `signed-out` and `expired` only. */
  readonly userId?: string;
  /**
   * The client address, after trusted-proxy resolution (the rightmost
   * `X-Forwarded-For` hop that is not a trusted proxy; the socket's address
   * otherwise). Absent on `expired`, which no request of that person caused.
   */
  readonly address?: string;
  /** `directory-password`: AD's bind sub-code (`'52e'`), when the bind was refused with one. */
  readonly adSubCode?: string;
  /** `directory-password`: what the sub-code means (`'bad-password'`). */
  readonly adSubCodeName?: AdSubCodeName;
}

/**
 * Where records go — `signInDoor({ onAudit })`. Called synchronously, once per
 * outcome. A sink that throws is contained (a broken log must not turn a
 * sign-in into a failure) and reported once through the door's `warn`. Do the
 * slow part yourself: buffer, and never `await` the network inside it.
 */
export type SignInAuditSink = (record: SignInAuditRecord) => void;

/** The prefix of the door's audit log line; the rest is the record as JSON. */
export const SIGN_IN_AUDIT_PREFIX = '[identity] sign-in';

/**
 * The record as ONE log line: the prefix, then a JSON object with `time` (ISO
 * 8601, UTC) in place of `at`. JSON so a name holding a quote or a space can
 * never forge a second field, and so a log pipeline parses it without a
 * grammar of its own.
 */
export function signInAuditLine(record: SignInAuditRecord): string {
  const { at, ...rest } = record;
  const json = JSON.stringify({ time: new Date(at).toISOString(), ...rest });
  // JSON leaves U+2028/U+2029 and the bidi controls raw; a viewer may break a
  // line at the first or reorder the text after the second. Escaped, the line
  // still parses to the same record.
  return `${SIGN_IN_AUDIT_PREFIX} ${json.replace(LINE_UNSAFE, escapeChar)}`;
}

/** Line and paragraph separators, and the bidi embedding/override/isolate controls. */
const LINE_UNSAFE = /[\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

function escapeChar(ch: string): string {
  return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/**
 * The door's bookkeeping: build a record from what it decided, send it to the
 * sink and the log, contain both. @internal — the option is public, this is not.
 */
export interface SignInAuditTrail {
  file(record: Omit<SignInAuditRecord, 'at'>): void;
}

export function signInAuditTrail(options: {
  readonly sink?: SignInAuditSink;
  readonly log: (line: string) => void;
  readonly warn: (message: string) => void;
  readonly now: () => number;
}): SignInAuditTrail {
  let warned = false;
  const contained = (where: string, run: () => void): void => {
    try {
      run();
    } catch (err) {
      if (warned) return;
      warned = true;
      options.warn(
        `[hosting] signInDoor: the ${where} threw and a sign-in record was dropped. Sign-in is ` +
          `unaffected, but this door's audit trail is not being recorded. Reported once per ` +
          `door. Cause: ${(err as { name?: string } | undefined)?.name ?? 'unknown'}`,
      );
    }
  };
  return {
    file(fields) {
      const record: SignInAuditRecord = { at: options.now(), ...fields };
      const sink = options.sink;
      if (sink !== undefined) contained('onAudit sink', () => sink(record));
      contained('audit log', () => options.log(signInAuditLine(record)));
    },
  };
}
