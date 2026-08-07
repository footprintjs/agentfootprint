[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSourceAdapter

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:474](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L474)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:475](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L475)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:477](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L477)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:476](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L476)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>

Defined in: [src/adapters/types.ts:478](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/adapters/types.ts#L478)

#### Parameters

##### ctx

[`ResolveCtx`](/agentfootprint/api/generated/interfaces/ResolveCtx.md)

#### Returns

`Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>
