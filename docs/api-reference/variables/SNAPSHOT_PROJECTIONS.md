[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SNAPSHOT\_PROJECTIONS

# Variable: SNAPSHOT\_PROJECTIONS

> `const` **SNAPSHOT\_PROJECTIONS**: `object`

Defined in: [agentfootprint/src/memory/define.types.ts:104](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L104)

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
