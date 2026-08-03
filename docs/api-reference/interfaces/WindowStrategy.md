[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowStrategy

# Interface: WindowStrategy

Defined in: [src/core/agent/window/strategy.ts:165](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/agent/window/strategy.ts#L165)

A window strategy: what the live window should become at this iteration
boundary, and what the record must say about the change.

Pass one to `AgentBuilder.window(...)`. Exactly one per agent —
`.compaction(...)` is the same door with `summarizeOldest` already in it.

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/window/strategy.ts:171](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/agent/window/strategy.ts#L171)

Stable name — it is written onto every record this strategy files
(`WindowRecord.strategy`), so a reader can tell which policy produced a
window, and it names the strategy on the chart's `compact` stage.

## Methods

### plan()

> **plan**(`input`): `Promise`\<[`WindowStrategyResult`](/agentfootprint/api/generated/interfaces/WindowStrategyResult.md) \| `undefined`\>

Defined in: [src/core/agent/window/strategy.ts:183](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/agent/window/strategy.ts#L183)

Decide. Called at EVERY ReAct iteration boundary.

Return `undefined` when this strategy did not engage — nothing was over
budget, nothing was old enough, nothing has been counted yet. The ledger
stays untouched and the run proceeds.

Return a result for anything else, INCLUDING a visit that changed
nothing because every candidate refused. Those are the visits a person
debugging an oversized window actually needs.

#### Parameters

##### input

[`WindowStrategyInput`](/agentfootprint/api/generated/interfaces/WindowStrategyInput.md)

#### Returns

`Promise`\<[`WindowStrategyResult`](/agentfootprint/api/generated/interfaces/WindowStrategyResult.md) \| `undefined`\>
