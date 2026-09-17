---
title: WindowStrategyResult
---

# Interface: WindowStrategyResult

Defined in: [src/core/agent/window/strategy.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L155)

What the stage should do next.

## Properties

### budgetPressure?

> `readonly` `optional` **budgetPressure?**: `object`

Defined in: [src/core/agent/window/strategy.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L203)

The budget reading to report on `agentfootprint.context.budget_pressure`.

OMIT IT when the strategy has no token budget. `slidingWindow` does: it
triggers on turn count, and filling `capTokens` with a number nobody
configured would be the invented figure this family refuses. No budget,
no budget_pressure event.

`unit` says what the two numbers count, because the context SLOTS emit
this same event name with the same `slot: 'messages'` and count in CHARS.
It defaults to `'tokens'` — every shipped strategy compares against a
`thresholdTokens`, so that is what all three already mean. Set it to
`'chars'` if yours measures characters, and the event will say so.

#### capTokens

> `readonly` **capTokens**: `number`

#### planAction

> `readonly` **planAction**: `"evict"` \| `"summarize"` \| `"none"`

#### projectedTokens

> `readonly` **projectedTokens**: `number`

#### unit?

> `readonly` `optional` **unit?**: `"chars"` \| `"tokens"`

***

### evictions

> `readonly` **evictions**: readonly [`WindowEviction`](/docs/api/interfaces/WindowEviction)[]

Defined in: [src/core/agent/window/strategy.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L173)

Messages that left the window, for `context.evicted`.

***

### folded?

> `readonly` `optional` **folded?**: readonly [`FoldedSpan`](/docs/api/interfaces/FoldedSpan)[]

Defined in: [src/core/agent/window/strategy.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L188)

Spans this visit removed, in the form that OUTLIVES the process: appended
to the conversation checkpoint, so a restart can still say what a summary
stands for — and, under `retain: 'conversation'`, produce it verbatim.

OMIT IT unless your strategy replaced messages with something that stands
for them. `summarizeOldest` fills it because a summary is a claim that
needs its evidence; the drop strategies do not, because a drop replaces
nothing and its authored notice claims nothing.

The stage writes these in the SAME commit as the window change, so there
is no state in which messages left the window and the record of what they
were did not follow them.

***

### rebase?

> `readonly` `optional` **rebase?**: `object`

Defined in: [src/core/agent/window/strategy.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L165)

How the meter must re-align its provenance to the new window, which is
`[...head, (one new message)?, ...tail]`. Present exactly when `window`
is. `insertedAtMs` is the birth of the message the strategy put in the
span's place — omit it when the strategy removed messages and inserted
nothing.

#### headCount

> `readonly` **headCount**: `number`

#### insertedAtMs?

> `readonly` `optional` **insertedAtMs?**: `number`

#### keptTailCount

> `readonly` **keptTailCount**: `number`

***

### record

> `readonly` **record**: [`WindowRecord`](/docs/api/interfaces/WindowRecord)

Defined in: [src/core/agent/window/strategy.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L171)

What the ledger is told. Always present — an engaged visit explains itself.

***

### spend?

> `readonly` `optional` **spend?**: `object`

Defined in: [src/core/agent/window/strategy.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L210)

A billed call the strategy made, for the cost channel.

#### model

> `readonly` **model**: `string`

#### usage

> `readonly` **usage**: `object`

##### usage.input

> `readonly` **input**: `number`

##### usage.output

> `readonly` **output**: `number`

***

### warning?

> `readonly` `optional` **warning?**: `string`

Defined in: [src/core/agent/window/strategy.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L215)

A one-per-run dev warning the stage should print.

***

### window?

> `readonly` `optional` **window?**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/window/strategy.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/strategy.ts#L157)

The new window. Absent = leave the window alone.
