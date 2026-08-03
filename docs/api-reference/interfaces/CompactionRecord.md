[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CompactionRecord

# Interface: CompactionRecord

Defined in: src/core/agent/window/types.ts:141

What one OVER-BUDGET visit to `summarizeOldest` (what `.compaction()`
configures) put in the ledger.

## Extends

- [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

## Properties

### ~~foldedMessageCount~~

> `readonly` **foldedMessageCount**: `number`

Defined in: src/core/agent/window/types.ts:157

#### Deprecated

Use [WindowRecord.removedMessageCount](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount) — the family name
for the same value, published alongside it since 7.17. Both are written.

***

### ~~foldedStageIds~~

> `readonly` **foldedStageIds**: readonly `string`[]

Defined in: src/core/agent/window/types.ts:152

#### Deprecated

Use [WindowRecord.removedStageIds](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids) — the family name for
the same value, published alongside it since 7.17. Both are written.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/window/types.ts:125

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`iteration`](/agentfootprint/api/generated/interfaces/WindowRecord.md#iteration)

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: src/core/agent/window/types.ts:143

Adapter-reported input tokens of the last call — what tripped the check.

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: src/core/agent/window/types.ts:147

True when the measurement was over budget (a fold was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: src/core/agent/window/types.ts:134

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`refusals`](/agentfootprint/api/generated/interfaces/WindowRecord.md#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: src/core/agent/window/types.ts:129

How many messages left the window.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedMessageCount`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: src/core/agent/window/types.ts:127

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedStageIds`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids)

***

### strategy

> `readonly` **strategy**: `string`

Defined in: src/core/agent/window/types.ts:123

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`strategy`](/agentfootprint/api/generated/interfaces/WindowRecord.md#strategy)

***

### summarizerTokens?

> `readonly` `optional` **summarizerTokens?**: `object`

Defined in: src/core/agent/window/types.ts:161

What the summarizer call itself cost, when it reported usage.

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

***

### summaryChars

> `readonly` **summaryChars**: `number`

Defined in: src/core/agent/window/types.ts:159

Length of the summary text the summarizer produced (0 when none).

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: src/core/agent/window/types.ts:145

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: src/core/agent/window/types.ts:132

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsAfter`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: src/core/agent/window/types.ts:131

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsBefore`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsbefore)
