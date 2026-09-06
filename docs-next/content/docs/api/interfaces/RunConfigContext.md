---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:921](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L921)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:929](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L929)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:925](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L925)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:923](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L923)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:927](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L927)

This run's id — the same one that stamps every typed event's `meta.runId`.
