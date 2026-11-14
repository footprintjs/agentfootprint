---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types/configuration.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L19)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types/configuration.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L27)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types/configuration.ts:23](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L23)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types/configuration.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L21)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types/configuration.ts:25](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/configuration.ts#L25)

This run's id — the same one that stamps every typed event's `meta.runId`.
