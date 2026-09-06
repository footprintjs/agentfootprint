**Support** — the `CredentialProvider` port: vend a token so a tool can call a
downstream service.

## What it reads / what it writes
- Reads a tool's declared credential need and the caller's identity.
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
- `withCredentialRetry.ts` — a decorator for transient failures.
- `CredentialConsentRequiredError.ts` — the typed refusal.
