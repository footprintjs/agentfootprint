---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1170)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1178)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1174](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1174)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1172)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1176)

This run's id — the same one that stamps every typed event's `meta.runId`.
