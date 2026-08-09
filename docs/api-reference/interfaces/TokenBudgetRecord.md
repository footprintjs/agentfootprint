[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TokenBudgetRecord

# Interface: TokenBudgetRecord

Defined in: [src/core/agent/window/types.ts:172](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L172)

What one OVER-BUDGET visit to `tokenBudget` put in the ledger.

## Extends

- [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L121)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`iteration`](/agentfootprint/api/generated/interfaces/WindowRecord.md#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L181)

How many recent turns were off-limits to this visit.

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: [src/core/agent/window/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L175)

Adapter-reported input tokens of the last call — what tripped the check.

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: [src/core/agent/window/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L179)

True when the measurement was over budget (a drop was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L130)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`refusals`](/agentfootprint/api/generated/interfaces/WindowRecord.md#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L125)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedMessageCount`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L123)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedStageIds`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids)

***

### strategy

> `readonly` **strategy**: `"token-budget"`

Defined in: [src/core/agent/window/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L173)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`strategy`](/agentfootprint/api/generated/interfaces/WindowRecord.md#strategy)

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L177)

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L128)

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsAfter`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/window/types.ts#L127)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsBefore`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsbefore)
