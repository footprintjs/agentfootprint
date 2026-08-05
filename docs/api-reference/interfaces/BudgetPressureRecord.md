[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BudgetPressureRecord

# Interface: BudgetPressureRecord

Defined in: [src/recorders/core/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/types.ts#L99)

Budget-pressure warning — emitted before evictions fire.

`capTokens` / `projectedTokens` are historical names: slot budgets are
measured in CHARS. Renaming them would be breaking, so they stay.

`planAction: 'none'` means no mitigation was performed — nothing was
evicted or truncated and the full content still went to the LLM. It is
the honest reading of a slot that composed over its `budgetCap`.

## Properties

### capTokens

> `readonly` **capTokens**: `number`

Defined in: [src/recorders/core/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/types.ts#L101)

***

### overflowBy

> `readonly` **overflowBy**: `number`

Defined in: [src/recorders/core/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/types.ts#L103)

***

### planAction

> `readonly` **planAction**: `"abort"` \| `"evict"` \| `"summarize"` \| `"none"`

Defined in: [src/recorders/core/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/types.ts#L104)

***

### projectedTokens

> `readonly` **projectedTokens**: `number`

Defined in: [src/recorders/core/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/types.ts#L102)

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/types.ts#L100)
