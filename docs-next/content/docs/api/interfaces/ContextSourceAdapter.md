---
title: ContextSourceAdapter
---

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:336](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L336)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:337](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L337)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:339](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L339)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:338](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L338)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:340](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L340)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
