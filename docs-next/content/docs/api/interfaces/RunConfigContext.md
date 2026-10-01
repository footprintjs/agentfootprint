---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1220](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1220)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1228)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1224](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1224)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1222](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1222)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1226](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1226)

This run's id — the same one that stamps every typed event's `meta.runId`.
