---
title: RunConfig
---

# Interface: RunConfig

Defined in: [src/core/agent/types.ts:1149](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1149)

What `.configure(fn)` may change for one run. Both fields are
optional; returning `{}` (or nothing) means "use the built defaults",
which is exactly what an agent without `.configure()` does.

Deliberately NOT the tools axis — `.toolProvider()` already owns that,
and it is consulted every iteration rather than once per run.

## Properties

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: [src/core/agent/types.ts:1153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1153)

Replaces the base system prompt set by `.system(...)` for this run.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/types.ts:1151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1151)

Model id for every LLM call in this run.
