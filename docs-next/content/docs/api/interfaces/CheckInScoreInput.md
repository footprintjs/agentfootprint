---
title: CheckInScoreInput
---

# Interface: CheckInScoreInput

Defined in: src/core/checkin.ts:214

Input to a [CheckInScorer](/docs/api/type-aliases/CheckInScorer). Mirrors `influence-core`'s attribution
 shape so an embedding-backed scorer (wrapping `explainChoice`) drops in.

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: src/core/checkin.ts:220

Abort signal for network-backed scorers.

***

### tool

> `readonly` **tool**: `object`

Defined in: src/core/checkin.ts:216

The chosen tool. `text` is what gets scored (name + description + args).

#### name

> `readonly` **name**: `string`

#### text

> `readonly` **text**: `string`

***

### units

> `readonly` **units**: readonly `AttributionUnit`[]

Defined in: src/core/checkin.ts:218

The context units to rank against the tool.
