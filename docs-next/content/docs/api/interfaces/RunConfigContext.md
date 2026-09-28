---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1182)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1190)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1186)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1184)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1188)

This run's id — the same one that stamps every typed event's `meta.runId`.
