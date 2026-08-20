---
title: TokenBudgetRecord
---

# Interface: TokenBudgetRecord

Defined in: [src/core/agent/window/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L269)

What one OVER-BUDGET visit to `tokenBudget` put in the ledger.

## Extends

- [`WindowRecord`](/docs/api/interfaces/WindowRecord)

## Properties

### droppedObservations?

> `readonly` `optional` **droppedObservations?**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L179)

The tools whose RESULTS left the window on this visit, in first-appearance
order (9.57.0). Present only when at least one did.

This is the record's half of the sentence the drop notice says on the
wire, and it is filed even when no notice was authored at all — a removal
further into the window tells the model nothing, and then this is the only
place the fact exists. Uncapped and unfiltered, because the record is not
the wire: the notice prints at most four names and only plain identifiers,
this prints every name exactly as the tool declared it.

The failure it exists for was measured: a model whose `whats_here` result
had been evicted assembled a plausible id from an entity name it
remembered, was refused, and spent actions on it — and nothing in the run
said the evidence had gone.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`droppedObservations`](/docs/api/interfaces/WindowRecord#droppedobservations)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L153)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`iteration`](/docs/api/interfaces/WindowRecord#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L278)

How many recent turns were off-limits to this visit.

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: [src/core/agent/window/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L272)

Adapter-reported input tokens of the last call — what tripped the check.

***

### observations?

> `readonly` `optional` **observations?**: [`WindowObservations`](/docs/api/interfaces/WindowObservations)

Defined in: [src/core/agent/window/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L189)

What the last-tool-result pin did on this visit (9.57.0). Present only
when it did something: held a turn, turned one away at the ceiling, or
stood down.

See [WindowObservations](/docs/api/interfaces/WindowObservations). An agent with `keepLastToolResults: false`
— or one whose window held no pinnable tool result — never carries this
key, so its records are the exact shape they were before 9.57.0.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`observations`](/docs/api/interfaces/WindowRecord#observations)

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: [src/core/agent/window/types.ts:276](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L276)

True when the measurement was over budget (a drop was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/docs/api/interfaces/WindowRefusal)[]

Defined in: [src/core/agent/window/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L162)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`refusals`](/docs/api/interfaces/WindowRecord#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L157)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedMessageCount`](/docs/api/interfaces/WindowRecord#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L155)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedStageIds`](/docs/api/interfaces/WindowRecord#removedstageids)

***

### strategy

> `readonly` **strategy**: `"token-budget"`

Defined in: [src/core/agent/window/types.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L270)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`strategy`](/docs/api/interfaces/WindowRecord#strategy)

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L274)

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L160)

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsAfter`](/docs/api/interfaces/WindowRecord#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L159)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsBefore`](/docs/api/interfaces/WindowRecord#windowcharsbefore)
