[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CoveredResult

# Interface: CoveredResult\<T\>

Defined in: [src/core/agent/coverage/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L167)

The rendered coverage ledger, wrapped around the result it bounds.

## Type Parameters

### T

`T` = `unknown`

## Properties

### af\_coverage

> `readonly` **af\_coverage**: `object`

Defined in: [src/core/agent/coverage/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L168)

#### cannot\_cover?

> `readonly` `optional` **cannot\_cover?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

#### checked?

> `readonly` `optional` **checked?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

#### not\_checked?

> `readonly` `optional` **not\_checked?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

#### note

> `readonly` **note**: `string`

***

### result

> `readonly` **result**: `T`

Defined in: [src/core/agent/coverage/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L175)

The tool's own answer, untouched.
