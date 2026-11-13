# Generated redaction vocabulary

The parent facade owns the vocabulary's types and serving rule. The generator
writes bounded literal shards here from those types. Combined maps check both
missing and unknown keys; spreading shards does not loosen the old closed set.
`node scripts/gen-known-strings.mjs --check` checks every generated map.

This is a whole-literal move required by the file-size ratchet. No word or field
is made public by this folder. The public facade and redaction behavior stay
the same; the new event's registered fields are the only vocabulary additions.
