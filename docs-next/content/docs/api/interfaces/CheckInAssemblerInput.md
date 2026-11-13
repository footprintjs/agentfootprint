---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:514](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L514)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:519](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L519)

The proposed arguments, as the tool's view shows them
 ([CheckInRequest.args](/docs/api/interfaces/CheckInRequest#args)).

***

### hiddenArgs?

> `readonly` `optional` **hiddenArgs?**: readonly `string`[]

Defined in: [src/core/checkin.ts:522](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L522)

The arguments the tool's view hides from [args](/docs/api/interfaces/CheckInAssemblerInput#args)
 ([CheckInRequest.hiddenArgs](/docs/api/interfaces/CheckInRequest#hiddenargs)); absent when nothing is hidden.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:528](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L528)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:524](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L524)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:526](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L526)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:530](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L530)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:532](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L532)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:516](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L516)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
