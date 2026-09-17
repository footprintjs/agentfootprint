---
title: "~~Interface: ContextSourceAdapter~~"
---

# ~~Interface: ContextSourceAdapter~~

Defined in: [src/adapters/types.ts:588](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L588)

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

Defined in: [src/adapters/types.ts:589](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L589)

***

### ~~source~~

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:591](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L591)

***

### ~~targetSlot~~

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:590](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L590)

## Methods

### ~~resolve()~~

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>

Defined in: [src/adapters/types.ts:592](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L592)

#### Parameters

##### ctx

[`ResolveCtx`](/docs/api/interfaces/ResolveCtx)

#### Returns

`Promise`\<readonly [`ContextContribution`](/docs/api/interfaces/ContextContribution)[]\>
