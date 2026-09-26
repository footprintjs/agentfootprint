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

## Files
- `types.ts` — `SignIn`, the `SignInStore` and `SignInSource` ports, the cookie
  names, `HostSignInOptions`.
- `cookie.ts` — `readSignIn`, `signInKeyOf`, `withoutCredentials`.
- `source.ts` — `signInSource`: the lifetimes (absolute + idle) in one place.
- `hostSignIn.ts` — the host's `signIn` option checked at construction; the
  conversation door's handshake check and per-frame re-check.
