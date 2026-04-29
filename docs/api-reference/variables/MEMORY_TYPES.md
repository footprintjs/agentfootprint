[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_TYPES

# Variable: MEMORY\_TYPES

> `const` **MEMORY\_TYPES**: `object`

Defined in: [agentfootprint/src/memory/define.types.ts:56](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L56)

What shape of memory you're keeping.

- `EPISODIC`  — raw conversation messages, replayed on next turn
- `SEMANTIC`  — extracted structured facts, deduped on key
- `NARRATIVE` — beats / summaries of prior runs (append-only)
- `CAUSAL`    — footprintjs execution snapshots, the differentiator
                (zero-hallucination follow-ups via decision-evidence replay)

## Type Declaration

### CAUSAL

> `readonly` **CAUSAL**: `"causal"` = `'causal'`

### EPISODIC

> `readonly` **EPISODIC**: `"episodic"` = `'episodic'`

### NARRATIVE

> `readonly` **NARRATIVE**: `"narrative"` = `'narrative'`

### SEMANTIC

> `readonly` **SEMANTIC**: `"semantic"` = `'semantic'`
