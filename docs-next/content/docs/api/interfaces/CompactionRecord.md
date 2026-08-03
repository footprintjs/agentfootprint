---
title: CompactionRecord
---

# Interface: CompactionRecord

Defined in: [src/core/agent/window/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L141)

What one OVER-BUDGET visit to `summarizeOldest` (what `.compaction()`
configures) put in the ledger.

## Extends

- [`WindowRecord`](/docs/api/interfaces/WindowRecord)

## Properties

### ~~foldedMessageCount~~

> `readonly` **foldedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L157)

#### Deprecated

Use [WindowRecord.removedMessageCount](/docs/api/interfaces/WindowRecord#removedmessagecount) — the family name
for the same value, published alongside it since 7.17. Both are written.

***

### ~~foldedStageIds~~

> `readonly` **foldedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L152)

#### Deprecated

Use [WindowRecord.removedStageIds](/docs/api/interfaces/WindowRecord#removedstageids) — the family name for
the same value, published alongside it since 7.17. Both are written.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L125)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`iteration`](/docs/api/interfaces/WindowRecord#iteration)

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: [src/core/agent/window/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L143)

Adapter-reported input tokens of the last call — what tripped the check.

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: [src/core/agent/window/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L147)

True when the measurement was over budget (a fold was attempted).

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

> `readonly` **strategy**: `string`

Defined in: [src/core/agent/window/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L123)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`strategy`](/docs/api/interfaces/WindowRecord#strategy)

***

### summarizerTokens?

> `readonly` `optional` **summarizerTokens?**: `object`

Defined in: [src/core/agent/window/types.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L161)

What the summarizer call itself cost, when it reported usage.

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

***

### summaryChars

> `readonly` **summaryChars**: `number`

Defined in: [src/core/agent/window/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L159)

Length of the summary text the summarizer produced (0 when none).

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L145)

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
