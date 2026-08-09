---
title: WindowStrategy
---

# Interface: WindowStrategy

Defined in: [src/core/agent/window/strategy.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L197)

A window strategy: what the live window should become at this iteration
boundary, and what the record must say about the change.

Pass one to `AgentBuilder.window(...)`. Exactly one per agent —
`.compaction(...)` is the same door with `summarizeOldest` already in it.

## Properties

### billing?

> `readonly` `optional` **billing?**: `object`

Defined in: [src/core/agent/window/strategy.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L217)

What this strategy will BILL, when it bills anything (8.14.0).

Omit it if your strategy makes no LLM call — the drop strategies do, and
a strategy that spends nothing has no billing to declare.

It exists so the agent BUILDER can check a strategy's spending against
the agent's own provider and model before the first run. Without it,
`.compaction({...})` could be refused for a configuration that
`.window(summarizeOldest({...}))` — the same strategy through the other
door — accepted silently. Two doors onto one policy must refuse the same
things, or the refusal is advice rather than a rule.

#### model

> `readonly` **model**: `string`

#### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/window/strategy.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L203)

Stable name — it is written onto every record this strategy files
(`WindowRecord.strategy`), so a reader can tell which policy produced a
window, and it names the strategy on the chart's `compact` stage.

## Methods

### plan()

> **plan**(`input`): `Promise`\<[`WindowStrategyResult`](/docs/api/interfaces/WindowStrategyResult) \| `undefined`\>

Defined in: [src/core/agent/window/strategy.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L232)

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
