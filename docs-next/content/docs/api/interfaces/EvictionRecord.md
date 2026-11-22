---
title: EvictionRecord
---

# Interface: EvictionRecord

Defined in: [src/recorders/core/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L92)

Eviction record — a piece that was removed from a slot under pressure.

## Properties

### contentHash

> `readonly` **contentHash**: `string`

Defined in: [src/recorders/core/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L94)

***

### reason

> `readonly` **reason**: `"budget"` \| `"stale"` \| `"low_score"` \| `"policy"` \| `"user_revoked"`

Defined in: [src/recorders/core/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L95)

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L93)

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: [src/recorders/core/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L96)
