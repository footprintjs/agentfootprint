**Support** — one adapter per credential source behind the `CredentialProvider`
port, plus one inbound verifier.

## What it reads / what it writes
Vends a credential for a tool to call a downstream service. It must never write
a token into tracked scope: tracked writes flow into the record.

## The one law here
A vended token is not evidence. Nothing here may reach the Trace, and nothing
here composes a sentence — `src/identity/CredentialConsentRequiredError.ts` owns
what a caller is told.

## Files
- `agentcore.ts`, `azure.ts`, `google.ts`, `vault.ts` — outbound credential
  sources.
- `jwks.ts` — verify a caller's bearer token against a published key set.
