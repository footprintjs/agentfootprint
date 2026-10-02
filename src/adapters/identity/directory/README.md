**Support** — the `directory-password` strategy: Active Directory says who a
person is, over LDAPS. It decides who may call; it composes nothing a model
reads.

## What it reads / what it writes
Reads a typed username and password (from the sign-in door) and the directory.
Writes nothing; the password is never stored, logged or forwarded. A refusal's
REASON (and AD's sub-code) goes to the sign-in door's audit record through
`PasswordChecker.check`'s `note` — never to the person.

## The one law here
The directory's Who-am-I, not the typed name, decides who signed in (rule 18):
bind, ask RFC 4532 Who-am-I, then find EXACTLY ONE entry for the account it
names and take that entry's `objectGUID`. That closes the rename collision
where Jane's explicit UPN beats John's implicit one.

```ts
const passwords = directoryPasswords({
  directory: ldapDirectory({ url: 'ldaps://dc1.corp.example:636', caPem }),
  domain: 'corp.example',
  netbiosDomain: 'CORP',
  baseDn: 'DC=corp,DC=example',
  requiredGroup: 'CN=Neo Users,OU=Groups,DC=corp,DC=example',
});
```

## Trust the ROOT, or Node's store — never unset
`ldapDirectory` takes exactly one trust: `caPem` (the company's ROOT CA) or
`systemCa: true` (Node's default store: Mozilla's public roots, plus
`NODE_EXTRA_CA_CERTS`, plus the OS store under `--use-system-ca`). From config:
`IDENTITY_LDAP_CA_FILE=/path/root.pem` or `IDENTITY_LDAP_CA_FILE=system` —
there is no unset-means-system. The host-name check is on either way, and there
is no switch to skip verification.

Why the root: a DC certificate is renewed every few months, and an
intermediate is replaced on its own schedule. A pin on either breaks sign-in at
the next renewal. A root lives for years, and the DC sends the leaf and its
intermediates in the TLS handshake, so a renewal changes nothing here. A leaf
in the CA file is refused at boot (it is not a CA); an intermediate boots with
a banner WARNING.

```ts
ldapDirectory({ url: 'ldaps://ad.corp.example:636', systemCa: true }); // a public CA issued the DC cert
ldapDirectory({ url: 'ldaps://ad.corp.example:636', caPem: rootPem }); // a company root
```

## Meeting a company's AD checklist
A typical security checklist for an app that signs people in against AD, and
where this library meets each line. Lab = the Samba AD lab run on 2026-10-02.

| # | Requirement | How it is met | Pinned by |
|---|---|---|---|
| 1 | LDAPS 636, certificate verified, host name checked, trust the PUBLIC root, never pin leaf or intermediate | `ldapDirectory` refuses `ldap://`; `rejectUnauthorized: true`, Node's own host-name check (no `checkServerIdentity` override); `systemCa: true` / `IDENTITY_LDAP_CA_FILE=system` trusts Node's public roots; a leaf CA file is refused, an intermediate warned. Lab: `ldaps://127.1` → `ERR_TLS_CERT_ALTNAME_INVALID`; system mode refuses the lab's private CA (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) and accepts it once `NODE_EXTRA_CA_CERTS` names it | `test/hosting/sign-in-audit.test.ts` (systemCa, intermediate), `test/adapters/identity/directory-password.test.ts` (TLS options) |
| 2 | ~5 s connect timeout; a load-balanced LDAP name | `timeout` and `connectTimeout` default 5 000 ms. A load-balanced name works as the URL host — every DC behind it must carry that name in its certificate's SAN, since the host-name check is against the URL | `sign-in-audit.test.ts` (5 s) |
| 3 | `user`, `DOMAIN\user`, `user@dns.domain` → sAMAccountName; RFC 4515 escaping; empty password refused before AD; passwords never stored or logged | `accountName` strips the CONFIGURED prefix/suffix only (another domain never binds); `accountBudgetKey` folds all three for the budget and the audit record; `escapeFilterValue`; the door refuses an empty password (400) and the checker again before the bind | `directory-password.test.ts`, `review-idI57-directory.test.ts`, `sign-in-audit.test.ts` (property: one account; no secret) |
| 4 | Membership of an access group, nested (in-chain) | `requiredGroup` / `IDENTITY_LDAP_REQUIRED_GROUP`: `memberOf:1.2.840.113556.1.4.1941:=` at base scope. The library cannot know the company's group, so it does not invent one; in production with no group the banner WARNS that every enabled account can sign in | `directory-password.test.ts` (nested group), lab: `not-in-group` |
| 5 | ≤ 5 failures per username per 15 min, then refused for 15 min WITHOUT contacting AD, for EVERY account (some never lock); a per-IP limit; never retry a bind | per ACCOUNT budget ⌊threshold/3⌋ (3 for AD's 10 — stricter than 5) over AD's window, from the LAST failure; threshold 0 (AD never locks) keeps the door's 5. It applies to every name, whatever AD's policy for that account. Per address: a growing delay, and the opt-in hard refusal `IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER`. The bind is sent once per attempt. Lab: 5 wrong tries through the door moved AD's `badPwdCount` by exactly 3 | `review-idI57-directory.test.ts` (B-1, B-2), `sign-in-audit.test.ts` (limited, opt-in, bind once) |
| 6 | AD sub-codes in the log (52e, 775, 532, 773, 533, 701); a generic message for the user | the bind's sub-code rides `DirectoryBind` → `note` → `SignInAuditRecord.adSubCode` + `adSubCodeName` (`adSubCodeName`); the person reads `WRONG_CREDENTIAL_SENTENCE`. Lab: 52e, 533, 775, 773, 701 all observed | `sign-in-audit.test.ts` (refused) |
| 7 | Log success AND failure with username, source IP, timestamp, AD sub-code; never passwords | the door's audit trail: one `[identity] sign-in {…}` line per outcome by default, and the typed `onAudit` / `onSignInAudit` sink | `sign-in-audit.test.ts` (every outcome; ROI; property) |

Two honest limits. AD answers `52e` for a name that does not exist too, so the
record cannot tell "no such user" from "wrong password" (that needs a service
account, which this strategy deliberately does not have). And most sub-codes
(533, 532, 773, 701) come back only when the password was RIGHT; `775`
(locked) comes back whatever the password.

## Files
- `port.ts` — the `Directory` port, `DirectoryBind` (a refusal may carry AD's
  sub-code), `adSubCodeName`, RFC 4515 filter escaping, SID → bytes.
- `directoryPasswords.ts` — the rules: empty password, name check, bind once,
  Who-am-I, exactly one entry, the nested group — each refusal noted with its
  reason.
- `ldapDirectory.ts` — the port over `ldapts` (optional peer), LDAPS only, one
  trust (`caPem` or `systemCa`), `intermediateCaSubjects` for the boot warning.
