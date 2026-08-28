---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:734](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L734)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:742](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L742)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:738](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L738)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:736](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L736)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:740](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L740)

This run's id — the same one that stamps every typed event's `meta.runId`.
