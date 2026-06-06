[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSourceAdapter

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L256)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L257)

***

### source

> `readonly` **source**: [`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md)

Defined in: [src/adapters/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L259)

***

### targetSlot

> `readonly` **targetSlot**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [src/adapters/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L258)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>

Defined in: [src/adapters/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/adapters/types.ts#L260)

#### Parameters

##### ctx

[`ResolveCtx`](/agentfootprint/api/generated/interfaces/ResolveCtx.md)

#### Returns

`Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>
