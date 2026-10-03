---
title: EvictionRecord
---

# Interface: EvictionRecord

Defined in: src/recorders/core/types.ts:82

Eviction record — a piece that was removed from a slot under pressure.

## Properties

### contentHash

> `readonly` **contentHash**: `string`

Defined in: src/recorders/core/types.ts:84

***

### reason

> `readonly` **reason**: `"budget"` \| `"stale"` \| `"low_score"` \| `"policy"` \| `"user_revoked"`

Defined in: src/recorders/core/types.ts:85

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: src/recorders/core/types.ts:83

***

### survivalMs

> `readonly` **survivalMs**: `number`

Defined in: src/recorders/core/types.ts:86
