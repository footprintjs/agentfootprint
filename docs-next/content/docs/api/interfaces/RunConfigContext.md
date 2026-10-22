---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1305](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1305)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1313](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1313)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1309](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1309)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1307](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1307)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1311](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1311)

This run's id — the same one that stamps every typed event's `meta.runId`.
