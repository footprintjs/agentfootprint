---
title: CompactionRecord
---

# Interface: CompactionRecord

Defined in: src/core/agent/compaction/types.ts:129

What one visit to the compaction stage put in the ledger. Appended to
`scope.compactions`, so the run's whole compaction story is one array in
the commit log — including the visits that folded NOTHING, which are the
interesting ones.

On `windowChars*` vs tokens: the char counts are EXACT and measured here.
There is deliberately no `tokensAfter` — nothing can count the tokens of a
window that has not been sent yet, and inventing one would be exactly the
guess this feature exists to refuse. The honest "after" is the NEXT call's
`stream.llm_end` usage.

## Properties

### foldedMessageCount

> `readonly` **foldedMessageCount**: `number`

Defined in: src/core/agent/compaction/types.ts:141

How many messages left the window.

***

### foldedStageIds

> `readonly` **foldedStageIds**: readonly `string`[]

Defined in: src/core/agent/compaction/types.ts:139

`runtimeStageId`s of the stages that appended the folded messages.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/compaction/types.ts:131

ReAct iteration this visit belongs to.

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: src/core/agent/compaction/types.ts:133

Adapter-reported input tokens of the last call — what tripped the check.

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: src/core/agent/compaction/types.ts:137

True when the measurement was over budget (a fold was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`FoldRefusal`](/docs/api/interfaces/FoldRefusal)[]

Defined in: src/core/agent/compaction/types.ts:150

Every turn that refused to fold, named.

***

### summarizerTokens?

> `readonly` `optional` **summarizerTokens?**: `object`

Defined in: src/core/agent/compaction/types.ts:148

What the summarizer call itself cost, when it reported usage.

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

***

### summaryChars

> `readonly` **summaryChars**: `number`

Defined in: src/core/agent/compaction/types.ts:146

Length of the summary text the summarizer produced (0 when none).

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: src/core/agent/compaction/types.ts:135

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: src/core/agent/compaction/types.ts:144

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: src/core/agent/compaction/types.ts:143

Window size in chars before / after this visit. Exact, and not tokens.
