---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:846](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L846)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:854](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L854)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:850](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L850)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:848](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L848)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:852](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L852)

This run's id — the same one that stamps every typed event's `meta.runId`.
