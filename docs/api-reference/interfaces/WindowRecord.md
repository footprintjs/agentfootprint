[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRecord

# Interface: WindowRecord

Defined in: [src/core/agent/window/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L136)

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

Defined in: [src/core/agent/window/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L143)

ReAct iteration this visit belongs to.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L152)

Every turn that refused to leave, named.

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L147)

How many messages left the window.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L145)

`runtimeStageId`s of the stages that appended the messages that left.

***

### strategy

> `readonly` **strategy**: `string`

Defined in: [src/core/agent/window/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L141)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L150)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/agent/window/types.ts#L149)

Window size in chars before / after this visit. Exact, and not tokens.
