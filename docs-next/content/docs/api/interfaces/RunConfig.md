---
title: RunConfig
---

# Interface: RunConfig

Defined in: [src/core/agent/types.ts:1274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1274)

What `.configure(fn)` may change for one run. Both fields are
optional; returning `{}` (or nothing) means "use the built defaults",
which is exactly what an agent without `.configure()` does.

Deliberately NOT the tools axis — `.toolProvider()` already owns that,
and it is consulted every iteration rather than once per run.

## Properties

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: [src/core/agent/types.ts:1278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1278)

Replaces the base system prompt set by `.system(...)` for this run.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/types.ts:1276](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1276)

Model id for every LLM call in this run.
