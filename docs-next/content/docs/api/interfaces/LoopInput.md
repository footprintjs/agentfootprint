---
title: LoopInput
---

# Interface: LoopInput

Defined in: [src/core-flow/Loop.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L76)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core-flow/Loop.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L84)

WHO this run is for — the same tuple as `AgentInput.identity`. Every
member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
member runs under this run's own conversation (`{ conversationId: runId }`),
never a namespace another run shares (`core/memberRun.ts`).

***

### message

> `readonly` **message**: `string`

Defined in: [src/core-flow/Loop.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L77)
