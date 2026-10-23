---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:467](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L467)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:471](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L471)

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:477](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L477)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:473](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L473)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:475](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L475)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:479](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L479)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:481](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L481)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:469](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L469)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
