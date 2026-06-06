[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_TYPES

# Variable: MEMORY\_TYPES

> `const` **MEMORY\_TYPES**: `object`

Defined in: [src/memory/define.types.ts:56](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/memory/define.types.ts#L56)

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
