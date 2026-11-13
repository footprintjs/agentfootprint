---
title: CheckInScoreInput
---

# Interface: CheckInScoreInput

Defined in: [src/core/checkin.ts:429](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L429)

Input to a [CheckInScorer](/docs/api/type-aliases/CheckInScorer). Mirrors `influence-core`'s attribution
 shape so an embedding-backed scorer (wrapping `explainChoice`) drops in.

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:435](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L435)

Abort signal for network-backed scorers.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:431](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L431)

The chosen tool. `text` is what gets scored (name + description + args).

#### name

> `readonly` **name**: `string`

#### text

> `readonly` **text**: `string`

***

### units

> `readonly` **units**: readonly [`AttributionUnit`](/docs/api/interfaces/AttributionUnit)[]

Defined in: [src/core/checkin.ts:433](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L433)

The context units to rank against the tool.
