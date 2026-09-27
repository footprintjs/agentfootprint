---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1138)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1146](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1146)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1142](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1142)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1140)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1144)

This run's id — the same one that stamps every typed event's `meta.runId`.
