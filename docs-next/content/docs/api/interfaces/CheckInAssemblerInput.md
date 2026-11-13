---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:507](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L507)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:511](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L511)

The proposed arguments, as the tool's view shows them ([CheckInRequest.args](/docs/api/interfaces/CheckInRequest#args)).

***

### hiddenArgs?

> `readonly` `optional` **hiddenArgs?**: readonly `string`[]

Defined in: [src/core/checkin.ts:513](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L513)

The arguments the view hides ([CheckInRequest.hiddenArgs](/docs/api/interfaces/CheckInRequest#hiddenargs)); absent when none.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:519](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L519)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:515](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L515)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:517](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L517)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:521](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L521)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:523](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L523)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:509](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L509)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
