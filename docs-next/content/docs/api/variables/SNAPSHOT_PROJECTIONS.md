---
title: SNAPSHOT_PROJECTIONS
---

# Variable: SNAPSHOT\_PROJECTIONS

> `const` **SNAPSHOT\_PROJECTIONS**: `object`

Defined in: [src/memory/define.types.ts:105](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/memory/define.types.ts#L105)

For Causal memory only — which slice of a footprintjs snapshot to
inject. Snapshots can run 100KB+; projecting prevents context blowup.

- `DECISIONS` — `decide()`/`select()` evidence only (the "why" chain)
- `COMMITS`   — commitLog only (every state write, ordered)
- `NARRATIVE` — narrative entries only (human-readable trace)
- `FULL`      — entire snapshot (use sparingly)

## Type Declaration

### COMMITS

> `readonly` **COMMITS**: `"commits"` = `'commits'`

### DECISIONS

> `readonly` **DECISIONS**: `"decisions"` = `'decisions'`

### FULL

> `readonly` **FULL**: `"full"` = `'full'`

### NARRATIVE

> `readonly` **NARRATIVE**: `"narrative"` = `'narrative'`
