---
title: ContextSourceAdapter
---

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:354](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L354)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:355](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L355)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:357](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L357)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:356](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L356)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:358](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L358)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
