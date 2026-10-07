---
title: "~~Interface: ContextSourceAdapter~~"
---

# ~~Interface: ContextSourceAdapter~~

Defined in: [src/adapters/types.ts:702](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L702)

## Deprecated

**Nothing implements or calls this, and nothing ever has.**
There is no option that accepts a `ContextSourceAdapter`, so a correct
implementation has nowhere to go. Removed in 10.0.0.

To put your own content into a slot, use the injection engine, which is
the seam that actually runs: `defineInjection` / `defineFact` /
`defineSkill` from `agentfootprint/context`. An injection names its
`flavor` and `trigger` and is resolved into the same three slots this
port describes.

## Properties

### ~~id~~

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:703](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L703)

***

### ~~source~~

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:705](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L705)

***

### ~~targetSlot~~

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:704](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L704)

## Methods

### ~~resolve()~~

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:706](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L706)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
