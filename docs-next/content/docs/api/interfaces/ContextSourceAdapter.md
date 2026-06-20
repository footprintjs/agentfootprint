---
title: ContextSourceAdapter
---

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L256)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L257)

***

### source

> `readonly` **source**: [`ContextSource`](/docs/api/type-aliases/ContextSource)

Defined in: [src/adapters/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L259)

***

### targetSlot

> `readonly` **targetSlot**: [`ContextSlot`](/docs/api/type-aliases/ContextSlot)

Defined in: [src/adapters/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L258)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L260)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
