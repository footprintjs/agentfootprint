---
title: WindowStrategy
---

# Interface: WindowStrategy

Defined in: src/core/agent/window/strategy.ts:165

A window strategy: what the live window should become at this iteration
boundary, and what the record must say about the change.

Pass one to `AgentBuilder.window(...)`. Exactly one per agent —
`.compaction(...)` is the same door with `summarizeOldest` already in it.

## Properties

### name

> `readonly` **name**: `string`

Defined in: src/core/agent/window/strategy.ts:171

Stable name — it is written onto every record this strategy files
(`WindowRecord.strategy`), so a reader can tell which policy produced a
window, and it names the strategy on the chart's `compact` stage.

## Methods

### plan()

> **plan**(`input`): `Promise`\<[`WindowStrategyResult`](/docs/api/interfaces/WindowStrategyResult) \| `undefined`\>

Defined in: src/core/agent/window/strategy.ts:183

Decide. Called at EVERY ReAct iteration boundary.

Return `undefined` when this strategy did not engage — nothing was over
budget, nothing was old enough, nothing has been counted yet. The ledger
stays untouched and the run proceeds.

Return a result for anything else, INCLUDING a visit that changed
nothing because every candidate refused. Those are the visits a person
debugging an oversized window actually needs.

#### Parameters

##### input

[`WindowStrategyInput`](/docs/api/interfaces/WindowStrategyInput)

#### Returns

`Promise`\<[`WindowStrategyResult`](/docs/api/interfaces/WindowStrategyResult) \| `undefined`\>
