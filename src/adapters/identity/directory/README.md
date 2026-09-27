**Support** — the `directory-password` strategy: Active Directory says who a
person is, over LDAPS. It decides who may call; it composes nothing a model
reads.

## What it reads / what it writes
Reads a typed username and password (from the sign-in door) and the directory.
Writes nothing; the password is never stored, logged or forwarded.

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

## Files
- `port.ts` — the `Directory` port, RFC 4515 filter escaping, SID → bytes.
- `directoryPasswords.ts` — the rules: empty password, name check, bind,
  Who-am-I, exactly one entry, the nested group.
- `ldapDirectory.ts` — the port over `ldapts` (optional peer), LDAPS only.
