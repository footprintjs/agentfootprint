[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CoveredResult

# Interface: CoveredResult\<T\>

Defined in: [src/core/agent/coverage/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/types.ts#L124)

The rendered coverage ledger, wrapped around the result it bounds.

## Type Parameters

### T

`T` = `unknown`

## Properties

### af\_coverage

> `readonly` **af\_coverage**: `object`

Defined in: [src/core/agent/coverage/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/types.ts#L125)

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

Defined in: [src/core/agent/coverage/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/coverage/types.ts#L132)

The tool's own answer, untouched.
