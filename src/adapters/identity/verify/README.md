**Support** — the shared kernel every INBOUND verifier checks a token through.
It decides who a token is about; it composes nothing a model reads.

## What it reads / what it writes
Reads a bearer token, a key set and (for `oidcIdentity`) a discovery document.
Writes nothing: it returns a claim set or throws a refusal by class.

## The one law here
One spelling of each check. `jwtCore.ts · verifySignedToken` is the only place a
signature, `iss`, `aud`, `exp` (required) and `nbf` are checked, so `jwksIdentity`
and `oidcIdentity` cannot drift apart. A refusal never carries the token, its
claims or the library's own text, and never a `cause`.

## Files
- `jwtCore.ts` — load `jose`, map its codes onto the failure classes, verify.
- `claims.ts` — a roles claim is a LIST (one string = one role), a scope claim is
  space-delimited, a claim name is never split (a path is an array).
- `personTest.ts` — only a person's token is a person; unknown roles are not none.
- `discovery.ts` — read the discovery document and classify: ready, outage,
  misconfigured.
