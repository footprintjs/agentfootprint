[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CompactionRecord

# Interface: CompactionRecord

Defined in: [src/core/agent/window/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L234)

What one OVER-BUDGET visit to `summarizeOldest` (what `.compaction()`
configures) put in the ledger.

## Extends

- [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

## Properties

### droppedObservations?

> `readonly` `optional` **droppedObservations?**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L179)

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

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`droppedObservations`](/agentfootprint/api/generated/interfaces/WindowRecord.md#droppedobservations)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:153](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L153)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`iteration`](/agentfootprint/api/generated/interfaces/WindowRecord.md#iteration)

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: [src/core/agent/window/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L236)

Adapter-reported input tokens of the last call — what tripped the check.

***

### observations?

> `readonly` `optional` **observations?**: [`WindowObservations`](/agentfootprint/api/generated/interfaces/WindowObservations.md)

Defined in: [src/core/agent/window/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L189)

What the last-tool-result pin did on this visit (9.57.0). Present only
when it did something: held a turn, turned one away at the ceiling, or
stood down.

See [WindowObservations](/agentfootprint/api/generated/interfaces/WindowObservations.md). An agent with `keepLastToolResults: false`
— or one whose window held no pinnable tool result — never carries this
key, so its records are the exact shape they were before 9.57.0.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`observations`](/agentfootprint/api/generated/interfaces/WindowRecord.md#observations)

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: [src/core/agent/window/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L240)

True when the measurement was over budget (a fold was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L162)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`refusals`](/agentfootprint/api/generated/interfaces/WindowRecord.md#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:157](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L157)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedMessageCount`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L155)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedStageIds`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids)

***

### strategy

> `readonly` **strategy**: `string`

Defined in: [src/core/agent/window/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L151)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`strategy`](/agentfootprint/api/generated/interfaces/WindowRecord.md#strategy)

***

### summarizerSkipped?

> `readonly` `optional` **summarizerSkipped?**: `boolean`

Defined in: [src/core/agent/window/types.ts:255](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L255)

Present and `true` when the summarizer was deliberately NOT called this
iteration (8.14.0): this exact span had already come back
`'replacement-not-smaller'`, and the same span through the same summarizer
gives the same answer. No call, so no `summarizerTokens` and no cost tick.

It is recorded rather than left out because a decision not to spend is
still a decision. A record with this flag and one without are different
facts, and a reader adding up an agent's fold attempts needs to see both.

***

### summarizerTokens?

> `readonly` `optional` **summarizerTokens?**: `object`

Defined in: [src/core/agent/window/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L244)

What the summarizer call itself cost, when it reported usage.

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`

***

### summaryChars

> `readonly` **summaryChars**: `number`

Defined in: [src/core/agent/window/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L242)

Length of the summary text the summarizer produced (0 when none).

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L238)

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L160)

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsAfter`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/window/types.ts#L159)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsBefore`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsbefore)
