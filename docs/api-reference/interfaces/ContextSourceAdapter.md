[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSourceAdapter

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:428](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/adapters/types.ts#L428)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:429](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/adapters/types.ts#L429)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:431](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/adapters/types.ts#L431)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:430](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/adapters/types.ts#L430)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>

Defined in: [src/adapters/types.ts:432](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/adapters/types.ts#L432)

#### Parameters

##### ctx

[`ResolveCtx`](/agentfootprint/api/generated/interfaces/ResolveCtx.md)

#### Returns

`Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>
