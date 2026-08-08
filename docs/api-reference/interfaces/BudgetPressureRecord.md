[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BudgetPressureRecord

# Interface: BudgetPressureRecord

Defined in: [src/recorders/core/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L110)

Budget-pressure warning — emitted before evictions fire.

`cap` and `projected` are counted in [unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit). They were added in 8.14.0
beside `capTokens` / `projectedTokens`, which asserted a unit this channel
does not use: on THIS channel the numbers are CHARS (`composeSlot` measures
`String.length`), while a window strategy fills the same event with tokens.
9.0.0 removed the two misnamed fields, and `cap` / `projected` are required
in their place — a record that carried neither pair would be a record with
no numbers on it.

[unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit) stays OPTIONAL, unlike on the event payload, because this
record is written by slot builders — including any a consumer wrote. A
missing `unit` reads as `'chars'`, which is not a guess: every write to
`COMPOSITION_KEYS.BUDGET_PRESSURE` comes off a slot composition, and a slot
composition is counted in characters by construction.

`planAction: 'none'` means no mitigation was performed — nothing was
evicted or truncated and the full content still went to the LLM. It is
the honest reading of a slot that composed over its `budgetCap`.

## Properties

### cap

> `readonly` **cap**: `number`

Defined in: [src/recorders/core/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L118)

The budget, in [unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit).

***

### overflowBy

> `readonly` **overflowBy**: `number`

Defined in: [src/recorders/core/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L112)

***

### planAction

> `readonly` **planAction**: `"abort"` \| `"evict"` \| `"summarize"` \| `"none"`

Defined in: [src/recorders/core/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L113)

***

### projected

> `readonly` **projected**: `number`

Defined in: [src/recorders/core/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L120)

What was measured against it, in [unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit).

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L111)

***

### unit?

> `readonly` `optional` **unit?**: `"chars"` \| `"tokens"`

Defined in: [src/recorders/core/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/types.ts#L116)

What the numbers count. Absent on a record written by a third-party slot
 builder — the slot channel is `'chars'`.
