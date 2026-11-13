---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: [src/core/checkin.ts:483](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L483)

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/checkin.ts:487](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L487)

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:493](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L493)

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: [src/core/checkin.ts:489](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L489)

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:491](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L491)

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:495](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L495)

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:497](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L497)

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:485](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L485)

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
