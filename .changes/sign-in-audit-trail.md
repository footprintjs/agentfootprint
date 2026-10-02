---
type: added
---
**A sign-in audit trail: every sign-in outcome, with the account, the client address, the time and AD's sub-code — never a password.**
The sign-in door now files one `SignInAuditRecord` per outcome — `signed-in`, `refused`, `limited`, `unavailable`, `signed-out`, `expired` — for every strategy that uses it (`local-password`, `directory-password`, browser sign-in). Each record carries a reason class, the strategy, the account (the typed name as the checker folds it: `user`, `DOMAIN\user` and `user@dns.domain` are one), the proved user id on success, the client address after `trustedProxies`, the time, and on `directory-password` Active Directory's bind sub-code with its name (`52e` bad-password, `775` locked, `532` password-expired, `773` must-change, `533` disabled, `701` account-expired, else `unknown`). It never carries a password, a cookie, a token or an error's message, and the person still reads one sentence for every wrong credential.

With no code, the door writes each record as one `[identity] sign-in {…}` JSON line through its new `log` option (default `console.info`). `signInDoor({ onAudit })` — or `identityFromConfig(…, { onSignInAudit, signInLog })` — hands you the typed record. A password checker can say why it refused through the new optional `note` argument of `PasswordChecker.check`; `DirectorySession.bind` may now answer `{ kind: 'invalid', adSubCode }` (a bare `'invalid'` still works).

Also for `directory-password`:
- `IDENTITY_LDAP_CA_FILE=system` (`ldapDirectory({ systemCa: true })`) trusts Node's default CA store — the public roots — for a DC certificate a public CA issued. It is explicit; an unset key is still refused. A CA file holding an intermediate boots with a warning: trust the root, which survives a renewal.
- `IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER` (`AttemptLimits.refuseAddressAfter`) opts in to REFUSING a client address after that many failures per window, not only delaying it. Off by default, because behind a shared NAT or proxy one person could lock everybody out.
- In production with no `IDENTITY_LDAP_REQUIRED_GROUP`, the banner warns that every enabled account can sign in.
- A directory that cannot be reached is logged with the connection or TLS error's code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID`). The per-refusal "directory bind refused" line from `ldapDirectory`'s `log` is gone: that sub-code now travels to the audit record.
