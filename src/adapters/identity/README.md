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
   **Every client in `allowedClients` must have service accounts / the
   client-credentials grant turned OFF**: on Keycloak and Okta a service
   account's token carries your API's scope, so the client check is the only
   thing that refuses it. `allowedClients: 'any'` is refused in production.
   (Check b, "roles and no scope", is kept as defence in depth: no outcome
   depends on it today, because check a refuses the same tokens.)
3. **The id claim is written down.** `oidcIdentity` has no `sub` default. Pick
   a claim only PEOPLE carry — the table below.
4. **Ids are opaque bytes**: never trimmed or case-folded.
5. **Every token expires.** A token without `exp` is `unverifiable`, in both
   verifiers, and an expired or not-yet-valid one is refused even when a custom
   `backend` skipped the time checks (`verify/jwtCore.ts · verifySignedToken`).
   Clock tolerance is at most 300 s: skew, not a second lifetime.
6. **A roles string is one role.** `"x neo-users"` never satisfies
   `neo-users`. `jwksIdentity({ rolesFormat: 'space-delimited' })` keeps the
   old reading for a claim that really is a list.
7. **Unknown is not none.** A roles claim replaced by an overage pointer is
   `roles-unknown`, never "no roles".
8. **Config errors refuse at boot; outages answer 503; production names its
   strategy.** A discovery 404, a redirect (never followed: the document picks
   the signing keys) or an `http` key set in production is a config error; a
   discovery timeout is an outage. After an outage boot, a later misconfigured
   answer is logged and retried, never final. The 503 a caller reads is a fixed
   sentence; the URL and the document's values go to the server log only.
9. **Secrets never travel.** No refusal, banner or record carries a token. A
   setting with a control character (a line break would forge a banner line)
   refuses to boot. `IDENTITY_ENDPOINT`, `IDENTITY_HEADER`,
   `IDENTITY_API_VERSION` and `IDENTITY_SERVER_THUMBPRINT` — a hosting
   platform's managed-identity variables — are skipped by
   `identityConfigFromEnv`, never read and never printed; a lower-case
   `identity_*` name is refused as a likely typo.
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

### The id claim, per identity provider

| IdP | `userIdClaim` | Why not `sub` | Scope claim |
|---|---|---|---|
| AD FS 2016+ | a custom claim issuing `objectGUID` (e.g. `urn:neo:objectguid`) | `sub` is a hash of the client id and the anchor claim | `scp` |
| Entra ID | `oid` | `sub` is pairwise per application | `scp` |
| Keycloak | the directory id mapper (`objectguid`, from LDAP `objectGUID`) | a service account HAS a `sub` and carries your scope; it has no directory id, so it is refused even if a client list is too broad (lab-proven) | `scope` |
| Okta | `uid` | unverified whether `sub` can hold the login | `scope` |

## Browser sign-in for `oidc-token` — `oidcSignIn` (PENDING INDEPENDENT REVIEW)

With `IDENTITY_PUBLIC_URL`, `IDENTITY_CLIENT_ID` and one client credential set
(together or not at all), `oidc-token` also signs people in through the
browser: the authorization-code flow, through `openid-client` (optional peer,
lazily loaded). Built and tested — a fake IdP, a real headless browser, a
Keycloak lab rehearsal — and gated on an outside human security review before
a company uses it.

- **One verification path (Q1).** The person is read from an ACCESS token for
  this API by the strategy's own `verify`; the ID token only carries the nonce.
  A browser sign-in and a bearer token give the same id. So
  `IDENTITY_AUDIENCE` equal to `IDENTITY_CLIENT_ID` refuses to boot.
- **Client authentication:** a private key (`private_key_jwt`) is preferred; a
  client secret (`client_secret_basic`) is accepted (design §5.2). Exactly one.
- **PKCE** is on unless `IDENTITY_PKCE=off` (AD FS 2016). Every token response
  must carry an ID token either way.
- `IDENTITY_RESOURCE` is sent as AD FS's `resource`; sign-out answers the IdP's
  end-session URL.

```sh
IDENTITY_PUBLIC_URL=https://neo.corp.example
IDENTITY_CLIENT_ID=<web client id>
IDENTITY_CLIENT_KEY_FILE=/run/secrets/neo-web.pem
IDENTITY_SCOPE=openid profile api://<API>/access_as_user
```

## `local-password` — development, tests and demos

`localPasswords('name:scrypt$…,…')` checks a password list; `hashPassword(pw)`
makes an entry. Hashed entries only — a plain password is refused at boot — and
the strategy is refused in production (a list in the environment is not a
production identity store). The KDF is **scrypt from `node:crypto`**: no new
dependency (argon2 needs a native module, bcrypt a package), and memory-hard,
which PBKDF2 is not. The default cost is OWASP's (N = 2^17, r = 8, p = 1); the
cost travels in the hash, and anything below N = 2^14 is refused. An unknown
name is checked against a real hash, so it costs what a known one does. The id
is the configured name, matched exactly: the one exception to "never a name a
person types", so renaming someone orphans their conversations.

```sh
IDENTITY_STRATEGY=local-password
IDENTITY_PUBLIC_URL=http://localhost:5350
IDENTITY_LOCAL_USERS=priya:scrypt$17$8$1$…$…   # from hashPassword('…')
```

## Files
- `agentcore.ts`, `azure.ts`, `google.ts`, `vault.ts` — outbound credential
  sources.
- `jwks.ts` — verify a caller's bearer token against a published key set.
- `oidc.ts` — the `oidc-token` verifier: discovery, AD FS's second issuer, the
  person test.
- `localPassword.ts` — the `local-password` list and `hashPassword` (scrypt).
- `oidcSignIn.ts` — browser sign-in over `openid-client` (pending independent review).
- `verify/` — the shared checks both verifiers use.
- `strategies/` — `identityFromConfig`, `identityConfigFromEnv`, the vocabulary.
