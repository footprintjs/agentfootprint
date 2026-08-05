[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowStrategyResult

# Interface: WindowStrategyResult

Defined in: [src/core/agent/window/strategy.ts:117](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L117)

What the stage should do next.

## Properties

### budgetPressure?

> `readonly` `optional` **budgetPressure?**: `object`

Defined in: [src/core/agent/window/strategy.ts:144](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L144)

The budget reading to report on `agentfootprint.context.budget_pressure`.

OMIT IT when the strategy has no token budget. `slidingWindow` does: it
triggers on turn count, and filling `capTokens` with a number nobody
configured would be the invented figure this family refuses. No budget,
no budget_pressure event.

#### capTokens

> `readonly` **capTokens**: `number`

#### planAction

> `readonly` **planAction**: `"evict"` \| `"summarize"` \| `"none"`

#### projectedTokens

> `readonly` **projectedTokens**: `number`

***

### evictions

> `readonly` **evictions**: readonly [`WindowEviction`](/agentfootprint/api/generated/interfaces/WindowEviction.md)[]

Defined in: [src/core/agent/window/strategy.ts:135](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L135)

Messages that left the window, for `context.evicted`.

***

### rebase?

> `readonly` `optional` **rebase?**: `object`

Defined in: [src/core/agent/window/strategy.ts:127](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L127)

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

Defined in: [src/core/agent/window/strategy.ts:133](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L133)

What the ledger is told. Always present — an engaged visit explains itself.

***

### spend?

> `readonly` `optional` **spend?**: `object`

Defined in: [src/core/agent/window/strategy.ts:150](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L150)

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

Defined in: [src/core/agent/window/strategy.ts:155](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L155)

A one-per-run dev warning the stage should print.

***

### window?

> `readonly` `optional` **window?**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/strategy.ts:119](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/core/agent/window/strategy.ts#L119)

The new window. Absent = leave the window alone.
