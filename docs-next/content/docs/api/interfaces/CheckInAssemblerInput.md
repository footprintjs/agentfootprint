---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:479](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L479)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:483](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L483)

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:489](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L489)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:485](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L485)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:487](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L487)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:491](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L491)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:493](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L493)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:481](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L481)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
