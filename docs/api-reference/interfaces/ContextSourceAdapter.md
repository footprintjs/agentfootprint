[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSourceAdapter

# ~~Interface: ContextSourceAdapter~~

Defined in: [src/adapters/types.ts:634](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L634)

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

Defined in: [src/adapters/types.ts:635](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L635)

***

### ~~source~~

> `readonly` **source**: `ContextSource`

Defined in: [src/adapters/types.ts:637](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L637)

***

### ~~targetSlot~~

> `readonly` **targetSlot**: `ContextSlot`

Defined in: [src/adapters/types.ts:636](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L636)

## Methods

### ~~resolve()~~

> **resolve**(`ctx`): `Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>

Defined in: [src/adapters/types.ts:638](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L638)

#### Parameters

##### ctx

[`ResolveCtx`](/agentfootprint/api/generated/interfaces/ResolveCtx.md)

#### Returns

`Promise`\<readonly [`ContextContribution`](/agentfootprint/api/generated/interfaces/ContextContribution.md)[]\>
