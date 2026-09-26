**Support** — one adapter per credential source behind the `CredentialProvider`
port, plus the inbound verifiers that prove who is calling.

## What it reads / what it writes
Vends a credential for a tool to call a downstream service. It must never write
a token into tracked scope: tracked writes flow into the record.

The inbound half reads a caller's bearer token and returns a
`VerifiedIdentity` or a refusal by class. It writes nothing.

## The one law here
A vended token is not evidence. Nothing here may reach the Trace, and nothing
here composes a sentence — `src/identity/CredentialConsentRequiredError.ts` owns
what a caller is told.

## Proving who is calling — the rules
A deployment picks ONE strategy by config (`strategies/`); the strategy's
`verify` is the only way a request gets a `userId`.

1. **Proved, never read.** A `userId` comes only from a strategy's `verify`.
2. **Only a person's token is a person.** `oidcIdentity` requires the scope
   only this API's person tokens carry, refuses app-only shapes (`idtyp: app`,
   `oid` equal to `sub`, roles and no scope) as `not-a-user-token`, and refuses
   a token obtained by an unlisted client as `wrong-client`. `jwksIdentity`
   checks who SIGNED a token, not whether it stands for a person — the
   conformance battery records that as a declaration.
3. **The id claim is written down.** `oidcIdentity` has no `sub` default.
4. **Ids are opaque bytes**: never trimmed or case-folded.
5. **Every token expires.** A token without `exp` is `unverifiable`, in both
   verifiers (`verify/jwtCore.ts · verifySignedToken`).
6. **A roles string is one role.** `"x neo-users"` never satisfies
   `neo-users`. `jwksIdentity({ rolesFormat: 'space-delimited' })` keeps the
   old reading for a claim that really is a list.
7. **Unknown is not none.** A roles claim replaced by an overage pointer is
   `roles-unknown`, never "no roles".
8. **Config errors refuse at boot; outages answer 503; production names its
   strategy.** A discovery 404 is a config error, a discovery timeout is an
   outage.
9. **Secrets never travel.** No refusal, banner or record carries a token.
10. **Every strategy passes one conformance battery against fakes before it
    ships** (`test/adapters/identity/conformance/`).

```ts
// Entra ID: a person's token verifies as `oid`; an app's own token is refused.
const verifier = oidcIdentity({
  issuer: 'https://login.microsoftonline.com/<tenant>/v2.0',
  audience: '<API client id>',
  userIdClaim: 'oid',
  requiredScope: 'access_as_user',
  allowedClients: ['<web client id>'],
});
await verifier.verify(personToken); // → { userId: '<oid>', roles, claims }
await verifier.verify(appOnlyToken); // → IdentityNotVerifiedError, failure 'not-a-user-token'
```

## Files
- `agentcore.ts`, `azure.ts`, `google.ts`, `vault.ts` — outbound credential
  sources.
- `jwks.ts` — verify a caller's bearer token against a published key set.
- `oidc.ts` — the `oidc-token` verifier: discovery, AD FS's second issuer, the
  person test.
- `verify/` — the shared checks both verifiers use.
- `strategies/` — `identityFromConfig`, `identityConfigFromEnv`, the vocabulary.
