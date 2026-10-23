---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:482](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L482)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:486](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L486)

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:492](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L492)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:488](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L488)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:490](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L490)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:494](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L494)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:496](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L496)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:484](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L484)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
