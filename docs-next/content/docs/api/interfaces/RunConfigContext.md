---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1283](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1283)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1291](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1291)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1287](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1287)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1285](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1285)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1289](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1289)

This run's id — the same one that stamps every typed event's `meta.runId`.
