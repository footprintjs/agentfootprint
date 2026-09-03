---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:912](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L912)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:920](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L920)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:916](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L916)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:914](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L914)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:918](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L918)

This run's id — the same one that stamps every typed event's `meta.runId`.
