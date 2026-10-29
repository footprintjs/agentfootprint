**Support** — the `CredentialProvider` port: vend a token so a tool can call a
downstream service.

## What it reads / what it writes
- Reads a tool's declared credential need and the caller's identity.
- Reads the run's sealed request (`CredentialRequest.request`), which the
  framework sets from the run a call belongs to — the agent's own run or the
  run a composition opened for its members (`core/memberRun.ts`). A call no
  run reaches carries none.
- Reads the abort signal of the request a credential is for
  (`CredentialRequest.signal`) when the caller passes one, as `gatewayTransport`
  does. It is the provider's cue to stop. `withCredentialRetry` passes it through,
  ends its backoff on it, and never retries a request whose signal has fired.
- Writes NOTHING into tracked scope. That is the standing invariant here:
  tracked writes flow into the record, and a vended token must never become
  evidence.

## The one law here
A credential is not context. Nothing in this folder composes a sentence a model
reads; `CredentialConsentRequiredError.ts` owns what a CALLER is told when a
turn ends waiting on consent.

## Files
- `types.ts` — the port.
- `kinds.ts` — the built-in credential shapes and their `toHeaders()`.
- `consent.ts` — the 3LO vocabulary, in one place because four surfaces must
  agree on it and three of them are security boundaries.
- `staticTokens.ts` — canned credentials for development.
- `requestContext.ts` — the incoming request's secrets, sealed per run (a
  module-private `WeakMap`; the handle has no readable field), and
  `bindRequest`, which makes every credential call carry its own run's request
  and nothing else.
- `requestCredentials.ts` — the provider that reads a sealed request, with its
  strategies (`asBearer`, `asApiKey`, `decodedWith`). Fails closed by name.
- `withCredentialRetry.ts` — a decorator for transient failures.
- `CredentialConsentRequiredError.ts` — the typed refusal.
