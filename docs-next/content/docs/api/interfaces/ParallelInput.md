---
title: ParallelInput
---

# Interface: ParallelInput

Defined in: [src/core-flow/Parallel.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L90)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core-flow/Parallel.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L98)

WHO this run is for — the same tuple as `AgentInput.identity`. Every
member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
member runs under this run's own conversation (`{ conversationId: runId }`),
never a namespace another run shares (`core/memberRun.ts`).

***

### message

> `readonly` **message**: `string`

Defined in: [src/core-flow/Parallel.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Parallel.ts#L91)
