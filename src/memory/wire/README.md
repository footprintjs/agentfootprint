**Map** — mounting a declared memory pipeline into an agent's chart.

## What it reads / what it writes
- Reads a `MemoryPipeline` (owner: `../pipeline/`).
- Writes chart structure: two subflows, read side and write side, mounted at the
  positions the agent chart declares. Nothing here runs during a turn.

## The one law here
Mounting is declaration. Where the subflows sit is fixed at build time so the
record's shape does not depend on what a turn did.

## Files
- `mountMemoryPipeline.ts` — the mount.
- `index.ts`.
