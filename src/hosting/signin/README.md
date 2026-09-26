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
```

## The sign-in door (`door.ts`)
`GET /auth/config`, `GET /auth/me`, `POST /auth/login` (password), `POST
/auth/logout`. The rules it keeps:

- **The browser holds no IdP token (rule 16)** — only a random cookie value;
  the server keeps the sign-in, and the store keeps only the value's SHA-256.
- **Password doors (rule 18):** the door guard runs on every login whatever it
  carries (a login carries no credential, so a gate keyed on one would never
  run: login forgery); JSON only; a bad body gets a fixed sentence (a parser's
  message would quote the password); an empty password is refused before any
  check; every wrong credential gets one answer after a minimum time — a
  store that fails included; a sign-in already present is ended.
- **Attempt limits hold under concurrency (`limits.ts`):** an attempt is
  counted when it STARTS, one check per typed name runs at a time (a second
  is 429 at once), and `checkGate.ts` caps checks door-wide (4 running, 32
  waiting, then 503 + `Retry-After`). The per-name budget refuses; the
  per-address budget only DELAYS (a proxy or a NAT must not let a stranger
  lock everybody out). Name and address counters live in separate bounded
  maps and a counter that still penalises is never evicted. This is what
  keeps a parallel burst under Active Directory's lockout threshold for
  `directory-password`.
- **Bounded, fair and per process (rule 19):** `memorySignIns` keeps at most
  10 000 live sign-ins and 10 per account (that account's oldest ends);
  expired rows are swept first; a full store REFUSES a new sign-in (503)
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
  safeReturnTo`.

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
- `checkGate.ts` — the door-wide cap on concurrent password checks.
- `clientAddress.ts` — the client address, trusted proxies (IPs and CIDR ranges).
- `errors.ts` — `SignInDoorConfigError`, `SignInStoreFullError`.
- `cookie.ts` — `readSignIn`, `signInKeyOf`, `withoutCredentials`.
- `source.ts` — `signInSource`: the lifetimes (absolute + idle) in one place.
- `hostSignIn.ts` — the host's `signIn` option checked at construction; the
  conversation door's handshake check and per-frame re-check.
