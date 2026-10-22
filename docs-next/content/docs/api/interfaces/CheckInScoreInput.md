---
title: CheckInScoreInput
---

# Interface: CheckInScoreInput

Defined in: [src/core/checkin.ts:371](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L371)

Input to a [CheckInScorer](/docs/api/type-aliases/CheckInScorer). Mirrors `influence-core`'s attribution
 shape so an embedding-backed scorer (wrapping `explainChoice`) drops in.

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:377](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L377)

Abort signal for network-backed scorers.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:373](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L373)

The chosen tool. `text` is what gets scored (name + description + args).

#### name

> `readonly` **name**: `string`

#### text

> `readonly` **text**: `string`

***

### units

> `readonly` **units**: readonly [`AttributionUnit`](/docs/api/interfaces/AttributionUnit)[]

Defined in: [src/core/checkin.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L375)

The context units to rank against the tool.
