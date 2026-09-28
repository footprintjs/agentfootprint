---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1181)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1189)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1185)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1183)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1187](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1187)

This run's id — the same one that stamps every typed event's `meta.runId`.
