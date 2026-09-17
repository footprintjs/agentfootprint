---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1014](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1014)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1022](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1022)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1018](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1018)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1016](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1016)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1020](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1020)

This run's id — the same one that stamps every typed event's `meta.runId`.
