**Support** — the stored item and its decay arithmetic.

## What it reads / what it writes
- Reads an entry's timestamps and half-life.
- Writes nothing: `decay` is a pure function retrieval stages call.

## The one law here
Decay changes an entry's effective relevance, never its content and never the
record of when it was written.

## Files
- `types.ts` — `MemoryEntry` with decay-, version- and source-aware metadata.
- `decay.ts` — the pure computation.
- `index.ts`.
