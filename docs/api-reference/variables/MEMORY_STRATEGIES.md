[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MEMORY\_STRATEGIES

# Variable: MEMORY\_STRATEGIES

> `const` **MEMORY\_STRATEGIES**: `object`

Defined in: [agentfootprint/src/memory/define.types.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/memory/define.types.ts#L71)

How content is selected / compressed for the next LLM call.

Universal across types. A `WINDOW` strategy on an Episodic store keeps
the last N messages; on a Causal store it keeps the last N snapshots.
Mix and match.

## Type Declaration

### BUDGET

> `readonly` **BUDGET**: `"budget"` = `'budget'`

### DECAY

> `readonly` **DECAY**: `"decay"` = `'decay'`

### EXTRACT

> `readonly` **EXTRACT**: `"extract"` = `'extract'`

### HYBRID

> `readonly` **HYBRID**: `"hybrid"` = `'hybrid'`

### SUMMARIZE

> `readonly` **SUMMARIZE**: `"summarize"` = `'summarize'`

### TOP\_K

> `readonly` **TOP\_K**: `"topK"` = `'topK'`

### WINDOW

> `readonly` **WINDOW**: `"window"` = `'window'`
