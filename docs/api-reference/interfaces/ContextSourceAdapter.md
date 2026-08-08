[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSourceAdapter

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:474](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/adapters/types.ts#L474)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:475](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/adapters/types.ts#L475)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:477](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/adapters/types.ts#L477)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:476](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/adapters/types.ts#L476)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>

Defined in: [src/adapters/types.ts:478](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/adapters/types.ts#L478)

#### Parameters

##### ctx

[`ResolveCtx`](/agentfootprint/api/generated/interfaces/ResolveCtx.md)

#### Returns

`Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>
