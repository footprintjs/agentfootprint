[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInScoreInput

# Interface: CheckInScoreInput

Defined in: [src/core/checkin.ts:214](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/checkin.ts#L214)

Input to a [CheckInScorer](/agentfootprint/api/generated/type-aliases/CheckInScorer.md). Mirrors `influence-core`'s attribution
 shape so an embedding-backed scorer (wrapping `explainChoice`) drops in.

## Properties

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/checkin.ts:220](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/checkin.ts#L220)

Abort signal for network-backed scorers.

***

### tool

> `readonly` **tool**: `object`

Defined in: [src/core/checkin.ts:216](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/checkin.ts#L216)

The chosen tool. `text` is what gets scored (name + description + args).

#### name

> `readonly` **name**: `string`

#### text

> `readonly` **text**: `string`

***

### units

> `readonly` **units**: readonly [`AttributionUnit`](/agentfootprint/api/generated/interfaces/AttributionUnit.md)[]

Defined in: [src/core/checkin.ts:218](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/checkin.ts#L218)

The context units to rank against the tool.
