---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:943](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L943)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:951](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L951)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:947](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L947)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:945](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L945)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:949](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L949)

This run's id — the same one that stamps every typed event's `meta.runId`.
