**Support** — the sign-in: the server's record of a person who proved who they
are through a browser, the cookie that names it, and the seam that keeps that
cookie away from every handler. It decides who may call; it composes nothing a
model reads.

## What it reads / what it writes
Reads the sign-in cookie off a request's headers, and a `SignInStore`.
Writes nothing of its own: the store is written by the sign-in door, and the
only thing that travels onward is the sign-in KEY (the cookie value's SHA-256).

## The one law here
The cookie comes off at the transport; only its key goes on. A handler, a
dialect, a log line and the ingress record never see the cookie (rule 10).

```ts
// An app's own route beside the host reads raw Node headers the same way:
const { key, headers } = readSignIn(req.headers);
const who = key === undefined ? undefined : await signIns.identify(key);
log.info({ path: req.url, headers: withoutCredentials(headers) });
// …and hands the KEY — never the cookie — to the artifact seam:
const scoped = await handle.artifactsForRequest({ sessionId, headers, signInKey: key });
```

## The sign-in door (`door.ts`)
`GET /auth/config`, `GET /auth/me`, `POST /auth/login` (password), `POST
/auth/logout`. The rules it keeps:

- **`/auth/config` says which password (`passwordKind`).** `{ mode:
  'password', passwordKind: 'directory' | 'local' }` — the checker's declared
  `PasswordChecker.kind`, fixed when the door is built, so a page labels its
  form ("Windows username (e.g. jsmith)" for `'directory'`, "Username" for
  `'local'`). A fact, never words; a checker with no `kind` adds no key; a word
  outside the two refuses at construction.
  ```ts
  const checker: PasswordChecker = { strategy: 'my-directory', kind: 'directory', check };
  // GET /auth/config → { "mode": "password", "passwordKind": "directory" }
  ```
- **The browser holds no IdP token (rule 16)** — only a random cookie value;
  the server keeps the sign-in, and the store keeps only the value's SHA-256.
- **Password doors (rule 18):** the door guard runs on every login whatever it
  carries (a login carries no credential, so a gate keyed on one would never
  run: login forgery); JSON only; a bad body gets a fixed sentence (a parser's
  message would quote the password); an empty password is refused before any
  check; every wrong credential gets one answer after a minimum time — a
  store that fails included; a sign-in already present is ended.
- **The minimum answer time is a duration: measured on the monotonic clock,
  waited in full.** The deadline is one `performance.now()` reading taken as
  the login starts, and the wait is `lib/sleep`'s, which never ends before
  that clock has passed it. Never the door's `now` (epoch ms — it dates
  sign-ins and attempt windows): it counts whole milliseconds, so a deadline
  taken late in one millisecond and read early in the next comes up to 1 ms
  short, and it jumps when the system time is set — an hour ahead answered at
  once. Tests follow the same split: the minimum is timed on the monotonic
  clock, and a limiter DECISION is read off the door (`_sleep` records the
  door's waits instead of sleeping them), never off a login's wall time, which
  is mostly the password check.
  ```ts
  const deadline = performance.now() + minimumMs; // door.ts · login
  const answer = async (status, body) => {
    await wait(deadline - performance.now()); // lib/sleep: never early
    reply(res, status, body);
  };
  // A limiter decision, read off the door (test/hosting/signInDoorHarness.ts · doorWaits):
  const waits = doorWaits();
  const door = signInDoor({
    ...options,
    minimumResponseMs: 0, // so the only wait that asks for time is the limiter's
    limits: { perName: 100, perAddress: 2, backoffMs: 60 },
    _sleep: waits.sleep, // recorded, never slept
  });
  await login(url, 'x1', 'p'); // one address's first wrong attempt: no delay
  expect(await waits.of(() => login(url, 'x2', 'p'))).toEqual([480]); // capped at 8 × backoffMs
  ```
- **The attempt delay is waited BEFORE the password is checked.** A decision
  the door does not apply slows nobody: `void wait(verdict.delayMs)` keeps
  every decision exactly right and lets every guess reach the checker at full
  speed. `doorWaits` cannot see that, because its waits end at once whether
  the door awaits them or not. So the order is its own law
  (`test/hosting/sign-in-door-delay.test.ts`): the test's `_sleep` HOLDS each
  wait for one turn of the event loop, and a delayed login must go `wait`,
  `waited`, `check`, `answer`. A door that does not await reaches the check
  first, every run: its path from the wait to the check is promise
  continuations only, and they all run before the loop's next turn.
  ```ts
  await wait(verdict.delayMs); // door.ts · login — the check runs in this wait's continuation
  // test/hosting/sign-in-door-delay.test.ts — the wait HELD one turn, every step recorded:
  _sleep: (ms) => {
    order.push(`wait ${ms}`);
    return new Promise((resolve) => setImmediate(() => (order.push(`waited ${ms}`), resolve())));
  },
  expect(order).toEqual(['wait 480', 'waited 480', 'check', 'answer']);
  ```
- **Attempt limits hold under concurrency (`limits.ts`):** an attempt is
  counted when it STARTS, under the key the CHECKER names
  (`PasswordChecker.budgetKey` — the account the typed name reaches, so
  `alice`, `ALICE` and `alice@corp.example` are one budget on
  `directory-password`); one check per key runs at a time (a second is 429 at
  once), and `checkGate.ts` caps checks door-wide (4 running, 32 waiting, then
  503 + `Retry-After`). A counter resets only a full window after its LAST
  attempt (Active Directory's own rule), so spacing attempts buys nothing. A
  check that threw `PasswordCheckUnreachableError` is un-counted; any other
  throw (a bind that timed out after it was sent) stays counted. The per-name
  budget refuses; the per-address budget only DELAYS (a proxy or a NAT must
  not let a stranger lock everybody out) unless `refuseAddressAfter` opts in,
  and a right password never adds to it. Name and address counters live in separate bounded maps and a counter
  that still penalises is never evicted — for a NAME that is any counted
  attempt, so a flood of junk names cannot push out a victim's counter at one
  failure; a map full of such counters answers a new name 503 (`busy`). For `directory-password` this
  REDUCES Active Directory lockout risk; it cannot rule it out (see
  `adapters/identity/README.md`).
  ```ts
  const checker: PasswordChecker = {
    strategy: 'my-directory',
    budgetKey: (typed) => typed.trim().toLowerCase(), // one account, one budget
    check: async (name, password) => lookUp(name, password), // undefined = wrong
  };
  ```
- **Every sign-in outcome is on the record (`audit.ts`).** One
  `SignInAuditRecord` per outcome — `signed-in`, `refused`, `limited`,
  `unavailable` at `/auth/login` and the redirect callback, `signed-out` at
  `/auth/logout` (a LIVE sign-in only), `expired` when `signInSource` finds one
  past a clock — goes to the typed sink `onAudit` AND, as one JSON line, to
  `log` (default `console.info`), so an install has the trail with no code. A
  record carries classes and identifiers: the reason class, the strategy, the
  ACCOUNT (the checker's `budgetKey`, so `user`, `DOMAIN\user` and
  `user@dns.domain` are one), the PROVED `userId`, the client address after
  `trustedProxies`, the time, and on `directory-password` AD's sub-code and its
  name. Never the password, the cookie, the sign-in key, a token or an error's
  message. A door option, not a typed event: every typed event's `EventMeta`
  needs a `runId`, and a sign-in is never a run — the `onIngressDecision`
  precedent. The record is filed at the exit the door reached, BEFORE the
  answer's minimum wait; a throwing sink or log is contained and reported once.
  A sign-in ENDS once on the record: two requests racing on one stale cookie
  (two tabs, a double-clicked sign-out) both see the row before either deletes
  it, so the door remembers the last 1 024 ended keys (`door.ts · recentKeys`)
  and files only the first end — pinned with a store whose lookup is slow.
  One thing the door cannot tell apart: a person who types their PASSWORD
  into the name field gets it on the record as the `account` (folded the way
  the checker folds a name), as every sign-in log that names the account
  does. Keep the trail where passwords would be safe enough, or drop
  `account` in your own sink. The line escapes U+2028/U+2029 and the bidi
  controls, so a name cannot break or reorder it in a viewer.
  ```ts
  const door = signInDoor({ ...options, onAudit: (r) => securityLog.write(r) });
  // and, with no code, on stdout:
  // [identity] sign-in {"time":"2026-10-02T02:13:43.144Z","outcome":"refused","reason":"wrong-credential",
  //   "strategy":"directory-password","account":"carol","address":"10.4.7.21","adSubCode":"775","adSubCodeName":"locked"}
  ```
- **A checker says WHY through `note`, never through the answer.**
  `PasswordChecker.check(name, password, note?)` — the door passes `note`; a
  checker calls it once with a `PasswordCheckDetail` (`reason`, and for a
  directory `adSubCode` + `adSubCodeName`) before resolving `undefined`. The
  door copies it down to that vocabulary (an unknown reason becomes
  `wrong-credential`, a sub-code that is not hex is dropped, an extra field is
  never read), so app code cannot put free text on the record. The person's
  answer is `WRONG_CREDENTIAL_SENTENCE` whatever was noted.
  ```ts
  check: async (name, password, note) => {
    const row = await lookUp(name);
    if (row === undefined) {
      note?.({ reason: 'unknown-account' }); // the record says it; the person never does
      return undefined;
    }
    // …
  },
  ```
- **The per-address budget can REFUSE, opt-in (`refuseAddressAfter`).** Off by
  default — behind a shared NAT or proxy every person is one address, and a
  hard address budget lets one person lock everybody out. An install where
  each person's own address reaches the door (`trustedProxies` set behind a
  proxy) can set it: past that many failed attempts in the window, the address
  is answered 429 without a check until a full window after its last counted
  attempt (refused attempts are not counted, so the refusal is bounded); a
  right password is no strike, but while the address is refused a right
  password is refused too — that is what a hard refusal means, and why it is
  off by default. `IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER` from config.
  ```ts
  limits: { perName: 3, windowMinutes: 15, refuseAddressAfter: 20 }
  ```
- **Bounded, fair and per process (rule 19):** `memorySignIns` keeps at most
  10 000 live sign-ins and 10 per account (that account's oldest ends);
  expired rows — and, given `idleMinutes`, idle-dead ones — are swept first; a full store REFUSES a new sign-in (503)
  rather than ending someone else's. Every removal is announced (`onDelete` →
  `onEnd`), so an open socket carrying it closes. A restart signs everybody
  out and a second replica does not share either — the banner says so.
- **The cookie:** `__Host-Http-af-signin`, `HttpOnly; Secure; SameSite=Strict;
  Path=/`, no `Domain`, `Max-Age` = the lifetime (8 h). On a plain-`http`
  localhost public URL — development only, refused in production — it is
  `af-signin` without `Secure`, because a browser drops a `__Host-` cookie
  that is not `Secure`; the banner says so.
- Sign-ins end after 8 hours, or 60 idle minutes under a password strategy.
- No `/auth` answer carries a CORS header; every one is `no-store` and
  unframeable.

```ts
const door = signInDoor({
  passwords: localPasswords(process.env.IDENTITY_LOCAL_USERS!),
  store: memorySignIns(),
  publicUrl: 'https://neo.corp.example',
  production: false,
  guard: { allowedHosts: ['neo.corp.example'] }, // the host's own list
});
const host = nodeHost({
  port: 8080,
  allowedHosts: ['neo.corp.example'],
  signIn: door.hostSignIn,
  onUnhandled: (req, res) => void door.handle(req, res).then((ok) => ok || res.writeHead(404).end()),
});
await standingAgent({ agent, sessions, host, identity: door.identity });
```

## The redirect half (`redirectRoutes.ts`) — PENDING INDEPENDENT REVIEW

`signInDoor({ redirect: oidcSignIn(…), verify })` adds `GET /auth/login` and
`GET /auth/callback`. Built and tested; its release is gated on an outside
human security review (design Q5).

- **Nothing on the server for a login.** The attempt's `state`, `nonce`, PKCE
  verifier and checked `returnTo` are SEALED (AES-256-GCM, bound to the cookie
  name) into a per-attempt `<cookie>-tx-<attempt>` cookie, `SameSite=Lax`, 10
  minutes. The transport strips it from handlers like the sign-in cookie.
- **The callback order is load-bearing:** open + match `state` → clear the
  transaction whatever happens → exchange (client credential + verifier) →
  ID token → the strategy's own `verify` on the ACCESS token → end any present
  sign-in → create → 303 with `Referrer-Policy: no-referrer`. A failure is a
  303 to `/?signin_error=<code>`, never the IdP's text.
- **`returnTo` never leaves the public origin (rule 20)** — `returnTo.ts ·
  safeReturnTo` — is kept only up to 512 bytes AFTER encoding, and never names
  the door itself (`/auth/login` would loop through a silent-SSO IdP, a new
  sign-in per lap). Anything refused is `/`.
- **Bounded per browser:** a login keeps the newest two OTHER pending
  transactions and expires the rest, and a sealed transaction past 1 200 bytes
  is re-sealed with `returnTo` `/` — so no page can plant enough cookies on
  this origin to make every request a 431.
- **The operator is told:** a failure that is the deployment's (the IdP or
  the store unreachable, the library missing) is logged by CLASS — never the
  IdP's text — once per change, and "working again" once it recovers. A store
  that fails at the callback is the usual redirect (`unavailable`), with the
  transaction cleared.
- **The door runs at the origin root:** a `publicUrl` with a path is refused
  (the cookies are `Path=/`, `__Host-`, and the redirect URI is
  `<origin>/auth/callback`).
- **Development only — `http://localhost`:** the transaction cookie has no
  `__Host-` prefix there, and cookies do not isolate by port, so another app
  on this machine can plant one. Production requires https and `__Host-`.
- **Accepted, documented (idI34 N-3):** a WebSocket that only RECEIVES
  outlives its sign-in until it sends a frame or closes; the re-check runs per
  inbound frame, coalesced behind one store lookup for a burst.

```ts
const verifier = oidcIdentity({ issuer, audience, userIdClaim: 'oid', requiredScope, allowedClients: [clientId] });
const door = signInDoor({
  redirect: oidcSignIn({ verifier, clientId, credential: { kind: 'private-key', pem }, scope: 'openid api://neo/access_as_user' }),
  verify: verifier.verify, // bearer callers use the same path
  store: memorySignIns(),
  publicUrl: 'https://neo.corp.example',
  production: true,
  guard: { allowedHosts: ['neo.corp.example'] },
  cookieKey: sealKeyFrom(readFileSync('/run/secrets/neo-cookie-key')),
});
```

## Files
- `types.ts` — `SignIn`, the `SignInStore`, `SignInSource` and
  `PasswordChecker` ports, the cookie names, `HostSignInOptions`.
- `door.ts` — `signInDoor`: the `/auth` routes.
- `redirectRoutes.ts` — the redirect half: login and callback.
- `seal.ts` — the sealed transaction cookie.
- `returnTo.ts` — `safeReturnTo`.
- `memorySignIns.ts` — the bounded in-memory store.
- `limits.ts` — attempt limits: counted at the start, bounded, per process.
- `audit.ts` — the audit trail: `SignInAuditRecord`, the reason vocabulary,
  the log line.
- `checkGate.ts` — the door-wide cap on concurrent password checks.
- `clientAddress.ts` — the client address, trusted proxies (IPs and CIDR ranges).
- `errors.ts` — `SignInDoorConfigError`, `SignInStoreFullError`.
- `cookie.ts` — `readSignIn`, `signInKeyOf`, `withoutCredentials`.
- `source.ts` — `signInSource`: the lifetimes (absolute + idle) in one place.
- `hostSignIn.ts` — the host's `signIn` option checked at construction; the
  conversation door's handshake check and per-frame re-check.
