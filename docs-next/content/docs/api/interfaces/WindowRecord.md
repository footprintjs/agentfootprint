---
title: WindowRecord
---

# Interface: WindowRecord

Defined in: [src/core/agent/window/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L146)

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

- [`CompactionRecord`](/docs/api/interfaces/CompactionRecord)
- [`SlidingWindowRecord`](/docs/api/interfaces/SlidingWindowRecord)
- [`TokenBudgetRecord`](/docs/api/interfaces/TokenBudgetRecord)

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

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L153)

ReAct iteration this visit belongs to.

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

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/docs/api/interfaces/WindowRefusal)[]

Defined in: [src/core/agent/window/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L162)

Every turn that refused to leave, named.

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L157)

How many messages left the window.

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L155)

`runtimeStageId`s of the stages that appended the messages that left.

***

### strategy

> `readonly` **strategy**: `string`

Defined in: [src/core/agent/window/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L151)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L160)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L159)

Window size in chars before / after this visit. Exact, and not tokens.
