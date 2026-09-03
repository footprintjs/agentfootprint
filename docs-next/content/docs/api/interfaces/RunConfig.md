---
title: RunConfig
---

# Interface: RunConfig

Defined in: [src/core/agent/types.ts:904](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L904)

What `.configure(fn)` may change for one run. Both fields are
optional; returning `{}` (or nothing) means "use the built defaults",
which is exactly what an agent without `.configure()` does.

Deliberately NOT the tools axis — `.toolProvider()` already owns that,
and it is consulted every iteration rather than once per run.

## Properties

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: [src/core/agent/types.ts:908](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L908)

Replaces the base system prompt set by `.system(...)` for this run.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/types.ts:906](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L906)

Model id for every LLM call in this run.
