[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSourceAdapter

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:354](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L354)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:355](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L355)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:357](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L357)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:356](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L356)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>

Defined in: [src/adapters/types.ts:358](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L358)

#### Parameters

##### ctx

[`ResolveCtx`](/agentfootprint/api/generated/interfaces/ResolveCtx.md)

#### Returns

`Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>
