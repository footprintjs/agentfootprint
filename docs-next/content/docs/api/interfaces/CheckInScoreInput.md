---
title: CheckInScoreInput
---

# Interface: CheckInScoreInput

Defined in: [src/core/checkin.ts:402](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L402)

Input to a [CheckInScorer](/docs/api/type-aliases/CheckInScorer). Mirrors `influence-core`'s attribution
 shape so an embedding-backed scorer (wrapping `explainChoice`) drops in.

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:408](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L408)

Abort signal for network-backed scorers.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:404](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L404)

The chosen tool. `text` is what gets scored (name + description + args).

#### name

> `readonly` **name**: `string`

#### text

> `readonly` **text**: `string`

***

### units

> `readonly` **units**: readonly [`AttributionUnit`](/docs/api/interfaces/AttributionUnit)[]

Defined in: [src/core/checkin.ts:406](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L406)

The context units to rank against the tool.
