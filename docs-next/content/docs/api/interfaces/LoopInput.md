---
title: LoopInput
---

# Interface: LoopInput

Defined in: [src/core-flow/Loop.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L63)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core-flow/Loop.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L71)

WHO this run is for — the same tuple as `AgentInput.identity`. Every
member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
member runs under this run's own conversation (`{ conversationId: runId }`),
never a namespace another run shares (`core/memberRun.ts`).

***

### message

> `readonly` **message**: `string`

Defined in: [src/core-flow/Loop.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L64)
