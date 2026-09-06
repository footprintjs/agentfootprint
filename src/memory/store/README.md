**Support** — the `MemoryStore` port (CRUD + seen/feedback/forget) and its
reference in-memory implementation.

## What it reads / what it writes
- Reads and writes rows, always scoped by the identity tuple.
- Holds no opinion about attention: what is RECALLED is decided by
  `../retrieval/`, and what is SAID about it by the formatters.

## The one law here
A store declares what its own `search()` can do (`capability.ts`) rather than
letting a caller assume it. A store that cannot do vector search says so, and
the refusal names the fix.

## Files
- `types.ts` — the I/O boundary.
- `InMemoryStore.ts` — the deliberately small reference implementation.
- `staticVectorStore.ts` — serve a corpus built somewhere else, read-only.
- `capability.ts`, `index.ts`.
