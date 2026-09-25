[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowStrategyResult

# Interface: WindowStrategyResult

Defined in: [src/core/agent/window/strategy.ts:156](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L156)

What the stage should do next.

## Properties

### budgetPressure?

> `readonly` `optional` **budgetPressure?**: `object`

Defined in: [src/core/agent/window/strategy.ts:204](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L204)

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

> `readonly` **evictions**: readonly [`WindowEviction`](/agentfootprint/api/generated/interfaces/WindowEviction.md)[]

Defined in: [src/core/agent/window/strategy.ts:174](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L174)

Messages that left the window, for `context.evicted`.

***

### folded?

> `readonly` `optional` **folded?**: readonly [`FoldedSpan`](/agentfootprint/api/generated/interfaces/FoldedSpan.md)[]

Defined in: [src/core/agent/window/strategy.ts:189](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L189)

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

Defined in: [src/core/agent/window/strategy.ts:166](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L166)

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

> `readonly` **record**: [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

Defined in: [src/core/agent/window/strategy.ts:172](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L172)

What the ledger is told. Always present — an engaged visit explains itself.

***

### spend?

> `readonly` `optional` **spend?**: `object`

Defined in: [src/core/agent/window/strategy.ts:211](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L211)

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

Defined in: [src/core/agent/window/strategy.ts:216](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L216)

A one-per-run dev warning the stage should print.

***

### window?

> `readonly` `optional` **window?**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/strategy.ts:158](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/strategy.ts#L158)

The new window. Absent = leave the window alone.
