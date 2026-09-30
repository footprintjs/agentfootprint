---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1206](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1206)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1214)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1210)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1208](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1208)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1212)

This run's id — the same one that stamps every typed event's `meta.runId`.
