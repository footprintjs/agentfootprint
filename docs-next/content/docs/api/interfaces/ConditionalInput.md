---
title: ConditionalInput
---

# Interface: ConditionalInput

Defined in: [src/core-flow/Conditional.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L73)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core-flow/Conditional.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L81)

WHO this run is for — the same tuple as `AgentInput.identity`. Every
member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
member runs under this run's own conversation (`{ conversationId: runId }`),
never a namespace another run shares (`core/memberRun.ts`).

***

### message

> `readonly` **message**: `string`

Defined in: [src/core-flow/Conditional.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Conditional.ts#L74)
