---
title: "~~Interface: ContextSourceAdapter~~"
---

# ~~Interface: ContextSourceAdapter~~

Defined in: [src/adapters/types.ts:663](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L663)

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

Defined in: [src/adapters/types.ts:664](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L664)

***

### ~~source~~

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:666](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L666)

***

### ~~targetSlot~~

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:665](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L665)

## Methods

### ~~resolve()~~

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:667](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L667)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
