---
title: RunConfigContext
---

# Interface: RunConfigContext

Defined in: [src/core/agent/types.ts:1314](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1314)

What a `.configure(fn)` resolver is given.

## Properties

### defaults

> `readonly` **defaults**: `object`

Defined in: [src/core/agent/types.ts:1322](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1322)

What the agent was BUILT with, so a resolver can decide relative to it.

#### instructions

> `readonly` **instructions**: `string`

#### model

> `readonly` **model**: `string`

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/types.ts:1318](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1318)

The memory identity passed to `run({ identity })`, when there was one.

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/types.ts:1316](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1316)

The message this run was started with.

***

### runId

> `readonly` **runId**: `string`

Defined in: [src/core/agent/types.ts:1320](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L1320)

This run's id — the same one that stamps every typed event's `meta.runId`.
