---
title: ContextSourceAdapter
---

# Interface: ContextSourceAdapter

Defined in: [src/adapters/types.ts:428](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L428)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:429](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L429)

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:431](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L431)

***

### targetSlot

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:430](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L430)

## Methods

### resolve()

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:432](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L432)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
