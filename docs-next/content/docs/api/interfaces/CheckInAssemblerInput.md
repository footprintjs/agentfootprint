---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:456](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L456)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:460](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L460)

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:466](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L466)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:462](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L462)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:464](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L464)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:468](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L468)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:470](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L470)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:458](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L458)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
