---
type: added
---
**`GET /auth/config` says which password a password door takes.** Both password strategies answered `{ mode: 'password' }`, so a page could not label its form for the company directory. A password door now adds `passwordKind: 'directory' | 'local'` — the checker's new optional `PasswordChecker.kind`, which `directoryPasswords` (`'directory'`) and `localPasswords` (`'local'`) declare. It is a fact, not words: label `'directory'` "Windows username (e.g. jsmith)" and `'local'` "Username". A custom checker that declares no `kind` adds no key; a word outside the two is refused when the door is built. `mode` is unchanged.
