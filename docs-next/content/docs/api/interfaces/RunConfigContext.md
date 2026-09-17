---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1048](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1048)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1056](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1056)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1052](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1052)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1050](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1050)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1054](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1054)

This run's id — the same one that stamps every typed event's `meta.runId`.
