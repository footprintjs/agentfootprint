---
title: CheckInAssemblerInput
---

# Interface: CheckInAssemblerInput

Defined in: src/core/checkin.ts:387

Everything the assembler needs to build one evidence pack.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/core/checkin.ts:391

The proposed arguments.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: src/core/checkin.ts:397

The conversation so far — the raw material for `read`, `drivers`, `trail`.

***

### intent?

> `readonly` `optional` **intent?**: `string`

Defined in: src/core/checkin.ts:393

The model's stated reasoning, if any (assistant-turn text).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/checkin.ts:395

The ReAct iteration this check-in fired on.

***

### scorer

> `readonly` **scorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: src/core/checkin.ts:399

The scorer to rank `drivers` with.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: src/core/checkin.ts:401

Abort signal threaded to the scorer.

***

### tool

> `readonly` **tool**: `object`

Defined in: src/core/checkin.ts:389

The chosen tool — `name` for citations, `description` for `willDo`.

#### description

> `readonly` **description**: `string`

#### name

> `readonly` **name**: `string`
