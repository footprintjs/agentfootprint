---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1277](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1277)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1285](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1285)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1281](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1281)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1279](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1279)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1283](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1283)

This run's id — the same one that stamps every typed event's `meta.runId`.
