---
title: RunConfig
---

# Interface: RunConfig

Defined in: [src/core/agent/types/configuration.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L11)

What `.configure(fn)` may change for one run. Both fields are
optional; returning `{}` (or nothing) means "use the built defaults",
which is exactly what an agent without `.configure()` does.

Deliberately NOT the tools axis — `.toolProvider()` already owns that,
and it is consulted every iteration rather than once per run.

## Properties

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: [src/core/agent/types/configuration.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L15)

Replaces the base system prompt set by `.system(...)` for this run.

***

### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/core/agent/types/configuration.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L13)

Model id for every LLM call in this run.
