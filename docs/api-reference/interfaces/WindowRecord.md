[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRecord

# Interface: WindowRecord

Defined in: [src/core/agent/window/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L114)

What one visit to the window stage put in the ledger.

Every strategy files one of these — including the visits that removed
NOTHING, which are the interesting ones. They are appended to
`scope.compactions`, so the run's whole window story is one array in the
commit log.

(`compactions` is the key `.compaction()` shipped with in 7.16 and the key
every strategy still writes: it is committed state, which is public surface
for anyone reading a run, and renaming it for a better word would break
those readers for nothing. It is named for the family's first member.)

On `windowChars*` vs tokens: the char counts are EXACT and measured here.
There is deliberately no `tokensAfter` — nothing can count the tokens of a
window that has not been sent yet, and inventing one would be exactly the
guess this family exists to refuse. The honest "after" is the NEXT call's
`stream.llm_end` usage.

## Extended by

- [`CompactionRecord`](/agentfootprint/api/generated/interfaces/CompactionRecord.md)
- [`SlidingWindowRecord`](/agentfootprint/api/generated/interfaces/SlidingWindowRecord.md)
- [`TokenBudgetRecord`](/agentfootprint/api/generated/interfaces/TokenBudgetRecord.md)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L121)

ReAct iteration this visit belongs to.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L130)

Every turn that refused to leave, named.

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L125)

How many messages left the window.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L123)

`runtimeStageId`s of the stages that appended the messages that left.

***

### strategy

> `readonly` **strategy**: `string`

Defined in: [src/core/agent/window/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L119)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L128)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/core/agent/window/types.ts#L127)

Window size in chars before / after this visit. Exact, and not tokens.
