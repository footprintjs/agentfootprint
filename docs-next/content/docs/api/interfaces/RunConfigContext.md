---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1157)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1165)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1161](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1161)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1159)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1163)

This run's id — the same one that stamps every typed event's `meta.runId`.
