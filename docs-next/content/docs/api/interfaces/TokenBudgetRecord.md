---
title: TokenBudgetRecord
---

# Interface: TokenBudgetRecord

Defined in: [src/core/agent/window/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L175)

What one OVER-BUDGET visit to `tokenBudget` put in the ledger.

## Extends

- [`WindowRecord`](/docs/api/interfaces/WindowRecord)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L125)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`iteration`](/docs/api/interfaces/WindowRecord#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L184)

How many recent turns were off-limits to this visit.

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: [src/core/agent/window/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L178)

Adapter-reported input tokens of the last call — what tripped the check.

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: [src/core/agent/window/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L182)

True when the measurement was over budget (a drop was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/docs/api/interfaces/WindowRefusal)[]

Defined in: [src/core/agent/window/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L134)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`refusals`](/docs/api/interfaces/WindowRecord#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L129)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedMessageCount`](/docs/api/interfaces/WindowRecord#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L127)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedStageIds`](/docs/api/interfaces/WindowRecord#removedstageids)

***

### strategy

> `readonly` **strategy**: `"token-budget"`

Defined in: [src/core/agent/window/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L176)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`strategy`](/docs/api/interfaces/WindowRecord#strategy)

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L180)

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L132)

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsAfter`](/docs/api/interfaces/WindowRecord#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L131)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsBefore`](/docs/api/interfaces/WindowRecord#windowcharsbefore)
