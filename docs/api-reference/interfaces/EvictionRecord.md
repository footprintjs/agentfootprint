[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EvictionRecord

# Interface: EvictionRecord

Defined in: [src/recorders/core/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L82)

Eviction record — a piece that was removed from a slot under pressure.

## Properties

### contentHash

> `readonly` **contentHash**: `string`

Defined in: [src/recorders/core/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L84)

***

### reason

> `readonly` **reason**: `"budget"` \| `"stale"` \| `"low_score"` \| `"policy"` \| `"user_revoked"`

Defined in: [src/recorders/core/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L85)

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L83)

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: [src/recorders/core/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L86)
