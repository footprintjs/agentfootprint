**Support** — the identity tuple, and the one encoding of it every durable store
uses.

## What it reads / what it writes
- Reads the run's tenant / principal / conversation fields.
- Writes key segments. This module is the TENANT BOUNDARY: every storage call in
  the library is scoped through it.

## The one law here
One field, one unambiguous key segment. Isolation is enforced at the storage
call, not assumed from a caller's discipline.

## Files
- `types.ts` — `MemoryIdentity`.
- `encode.ts` — the encoding, and the boundary.
- `index.ts`.
