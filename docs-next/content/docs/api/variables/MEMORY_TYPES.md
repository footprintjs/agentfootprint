---
title: MEMORY_TYPES
---

# Variable: MEMORY\_TYPES

> `const` **MEMORY\_TYPES**: `object`

Defined in: [src/memory/define.types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/memory/define.types.ts#L57)

What shape of memory you're keeping.

- `EPISODIC`  — raw conversation messages, replayed on next turn
- `SEMANTIC`  — extracted structured facts, deduped on key
- `NARRATIVE` — beats / summaries of prior runs (append-only)
- `CAUSAL`    — footprintjs execution snapshots, the differentiator
                (replays stored decisions + tool evidence for "why?"
                follow-ups — harvested automatically per run)

## Type Declaration

### CAUSAL

> `readonly` **CAUSAL**: `"causal"` = `'causal'`

### EPISODIC

> `readonly` **EPISODIC**: `"episodic"` = `'episodic'`

### NARRATIVE

> `readonly` **NARRATIVE**: `"narrative"` = `'narrative'`

### SEMANTIC

> `readonly` **SEMANTIC**: `"semantic"` = `'semantic'`
