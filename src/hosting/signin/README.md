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
  check; every wrong credential gets one answer after a minimum time; attempt
  limits grow a delay before refusing; a sign-in already present is ended.
- **Bounded and per process (rule 19):** `memorySignIns` keeps at most 10 000
  sign-ins (the oldest ends first); attempt counters are bounded too. A
  restart signs everybody out and a second replica does not share either —
  the banner says so. Run one replica, sticky sessions, or a shared store.
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

## Files
- `types.ts` — `SignIn`, the `SignInStore`, `SignInSource` and
  `PasswordChecker` ports, the cookie names, `HostSignInOptions`.
- `door.ts` — `signInDoor`: the `/auth` routes.
- `memorySignIns.ts` — the bounded in-memory store.
- `limits.ts` — attempt limits, bounded, per process.
- `cookie.ts` — `readSignIn`, `signInKeyOf`, `withoutCredentials`.
- `source.ts` — `signInSource`: the lifetimes (absolute + idle) in one place.
- `hostSignIn.ts` — the host's `signIn` option checked at construction; the
  conversation door's handshake check and per-frame re-check.
