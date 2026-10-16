---
title: SequenceInput
---

# Interface: SequenceInput

Defined in: [src/core-flow/Sequence.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Sequence.ts#L79)

## Properties

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core-flow/Sequence.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Sequence.ts#L87)

WHO this run is for — the same tuple as `AgentInput.identity`. Every
member runs for it: its memory, its tools' `ctx.identity`. Omitted, every
member runs under this run's own conversation (`{ conversationId: runId }`),
never a namespace another run shares (`core/memberRun.ts`).

***

### message

> `readonly` **message**: `string`

Defined in: [src/core-flow/Sequence.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Sequence.ts#L80)
