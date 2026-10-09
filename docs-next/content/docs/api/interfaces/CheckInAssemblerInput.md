---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:387](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L387)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:391](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L391)

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:397](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L397)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:393](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L393)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:395](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L395)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:399](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L399)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:401](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L401)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:389](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L389)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
