[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DeclaredCoverage

# Interface: DeclaredCoverage

Defined in: [src/core/agent/coverage/types.ts:186](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L186)

One coverage statement as the RUN recorded it — what the event carries and
what accumulates in `AgentState.coverageDeclared`.

`kind` is kept because the two read differently at the answer boundary: a
`'ledger'` bounds a verdict the answer is probably built on, an
`'absence'` bounds a search that found nothing.

## Extends

- [`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md)

## Properties

### cannotCover

> `readonly` **cannotCover**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L56)

#### Inherited from

[`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md).[`cannotCover`](/agentfootprint/api/generated/interfaces/Coverage.md#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L54)

#### Inherited from

[`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md).[`checked`](/agentfootprint/api/generated/interfaces/Coverage.md#checked)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/coverage/types.ts:190](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L190)

***

### kind

> `readonly` **kind**: `"absence"` \| `"ledger"`

Defined in: [src/core/agent/coverage/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L187)

***

### lookedFor?

> `readonly` `optional` **lookedFor?**: `string`

Defined in: [src/core/agent/coverage/types.ts:192](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L192)

Present for `'absence'` only — what the search was for.

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/coverage/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L55)

#### Inherited from

[`Coverage`](/agentfootprint/api/generated/interfaces/Coverage.md).[`notChecked`](/agentfootprint/api/generated/interfaces/Coverage.md#notchecked)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/coverage/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L189)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/coverage/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/coverage/types.ts#L188)
