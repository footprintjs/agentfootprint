---
title: RunConfig
---

# Interface: RunConfig

Defined in: [src/core/agent/types.ts:935](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L935)

What `.configure(fn)` may change for one run. Both fields are
optional; returning `{}` (or nothing) means "use the built defaults",
which is exactly what an agent without `.configure()` does.

Deliberately NOT the tools axis — `.toolProvider()` already owns that,
and it is consulted every iteration rather than once per run.

## Properties

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: [src/core/agent/types.ts:939](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L939)

Replaces the base system prompt set by `.system(...)` for this run.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/types.ts:937](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L937)

Model id for every LLM call in this run.
