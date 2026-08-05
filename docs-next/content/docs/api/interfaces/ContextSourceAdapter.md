---
title: ContextSourceAdapter
---

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:474](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L474)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:475](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L475)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:477](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L477)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:476](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L476)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:478](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L478)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
