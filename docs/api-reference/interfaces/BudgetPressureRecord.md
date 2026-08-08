[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BudgetPressureRecord

# Interface: BudgetPressureRecord

Defined in: [src/recorders/core/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L108)

Budget-pressure warning — emitted before evictions fire.

`capTokens` / `projectedTokens` are historical names: on THIS channel the
numbers are CHARS (`composeSlot` measures `String.length`). Renaming them
would be breaking, so they stay and [unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit) / [cap](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#cap) /
[projected](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#projected) were added beside them in 8.14.0.

The three new fields are OPTIONAL here, unlike on the event payload, because
this record is written by slot builders — including any a consumer wrote —
and a record from one of those still typechecks. `ContextRecorder` fills a
missing `unit` with `'chars'`, which is not a guess: every write to
`COMPOSITION_KEYS.BUDGET_PRESSURE` comes off a slot composition, and a slot
composition is counted in characters by construction.

`planAction: 'none'` means no mitigation was performed — nothing was
evicted or truncated and the full content still went to the LLM. It is
the honest reading of a slot that composed over its `budgetCap`.

## Properties

### cap?

> `readonly` `optional` **cap?**: `number`

Defined in: [src/recorders/core/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L120)

Same value as [capTokens](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#captokens), under a name that asserts no unit.

***

### ~~capTokens~~

> `readonly` **capTokens**: `number`

Defined in: [src/recorders/core/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L111)

#### Deprecated

Read [cap](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#cap) with [unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit). Still written.

***

### overflowBy

> `readonly` **overflowBy**: `number`

Defined in: [src/recorders/core/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L114)

***

### planAction

> `readonly` **planAction**: `"abort"` \| `"evict"` \| `"summarize"` \| `"none"`

Defined in: [src/recorders/core/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L115)

***

### projected?

> `readonly` `optional` **projected?**: `number`

Defined in: [src/recorders/core/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L122)

Same value as [projectedTokens](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#projectedtokens), under a name that asserts no unit.

***

### ~~projectedTokens~~

> `readonly` **projectedTokens**: `number`

Defined in: [src/recorders/core/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L113)

#### Deprecated

Read [projected](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#projected) with [unit](/agentfootprint/api/generated/interfaces/BudgetPressureRecord.md#unit). Still written.

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L109)

***

### unit?

> `readonly` `optional` **unit?**: `"chars"` \| `"tokens"`

Defined in: [src/recorders/core/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/recorders/core/types.ts#L118)

What the numbers count. Absent on a record written before 8.14.0 (or by
 a third-party slot builder) — the slot channel is `'chars'`.
