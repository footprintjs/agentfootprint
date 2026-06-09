[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_TYPES

# Variable: MEMORY\_TYPES

> `const` **MEMORY\_TYPES**: `object`

Defined in: [src/memory/define.types.ts:56](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/memory/define.types.ts#L56)

What shape of memory you're keeping.

- `EPISODIC`  — raw conversation messages, replayed on next turn
- `SEMANTIC`  — extracted structured facts, deduped on key
- `NARRATIVE` — beats / summaries of prior runs (append-only)
- `CAUSAL`    — footprintjs execution snapshots, the differentiator
                (replays stored run outcomes for "why?" follow-ups;
                operator-level decision-evidence wiring in progress)

## Type Declaration

### CAUSAL

> `readonly` **CAUSAL**: `"causal"` = `'causal'`

### EPISODIC

> `readonly` **EPISODIC**: `"episodic"` = `'episodic'`

### NARRATIVE

> `readonly` **NARRATIVE**: `"narrative"` = `'narrative'`

### SEMANTIC

> `readonly` **SEMANTIC**: `"semantic"` = `'semantic'`
