---
title: EvictionRecord
---

# Interface: EvictionRecord

Defined in: [src/recorders/core/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L85)

Eviction record — a piece that was removed from a slot under pressure.

## Properties

### contentHash

> `readonly` **contentHash**: `string`

Defined in: [src/recorders/core/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L87)

***

### reason

> `readonly` **reason**: `"budget"` \| `"stale"` \| `"low_score"` \| `"policy"` \| `"user_revoked"`

Defined in: [src/recorders/core/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L88)

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L86)

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: [src/recorders/core/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L89)
