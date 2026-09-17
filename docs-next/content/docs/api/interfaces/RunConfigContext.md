---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1092](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1092)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1100](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1100)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1096](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1096)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1094](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1094)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1098](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1098)

This run's id — the same one that stamps every typed event's `meta.runId`.
