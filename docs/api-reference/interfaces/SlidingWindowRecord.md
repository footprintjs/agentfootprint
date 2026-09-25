[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SlidingWindowRecord

# Interface: SlidingWindowRecord

Defined in: [src/core/agent/window/types.ts:323](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L323)

What one visit to `slidingWindow` put in the ledger.

## Extends

- [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

## Properties

### droppedObservations?

> `readonly` `optional` **droppedObservations?**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L207)

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

### droppedStandings?

> `readonly` `optional` **droppedStandings?**: readonly `object`[]

Defined in: [src/core/agent/window/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L246)

The standing of every tool result that LEFT the window on this visit,
by id, as the model had declared it (9.102.0) — beside
`droppedObservations`, which names the tools. Present only on an ARMED
agent (`.findings()` configured) and only when at least one tool result
left; an unarmed agent never carries this key.

`standing` absent is UNDECLARED — the model said nothing about that
result — never `'open'` and never a verdict the library inferred. It is
the model's claim, and it is filed by the STAGE so a consumer-written
strategy's record carries it too; a reader joining an evicted turn's
hash on the receipt to the ledger fold at that stop gets the same answer.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`droppedStandings`](/agentfootprint/api/generated/interfaces/WindowRecord.md#droppedstandings)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L181)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`iteration`](/agentfootprint/api/generated/interfaces/WindowRecord.md#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:326](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L326)

The configured keep depth this visit measured against.

***

### ledgerFacts?

> `readonly` `optional` **ledgerFacts?**: [`WindowObservations`](/agentfootprint/api/generated/interfaces/WindowObservations.md)

Defined in: [src/core/agent/window/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L232)

What the ledger-fact pin did on this visit (9.102.0). Present only when
it did something: held a turn, turned one away at the ceiling, or stood
down — and only on an ARMED agent (`.findings()` configured), so an
unarmed agent's records are the exact shape they were before.

The same [WindowObservations](/agentfootprint/api/generated/interfaces/WindowObservations.md) shape as `observations`, a second
block rather than a merged one: `limit` there is `keepLastToolResults`,
here it is `keepLedgerFacts`, and a reader adding up what each pin cost
needs them apart. The stand-down reads BOTH blocks: when the two previous
visits removed nothing and named only pins (`'last-tool-result'` and/or
`'ledger-fact'`), the fact pins release for this visit and this block
says so (`{ pinned: [], yielded: 0, limit, standDown: true }`).

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`ledgerFacts`](/agentfootprint/api/generated/interfaces/WindowRecord.md#ledgerfacts)

***

### observations?

> `readonly` `optional` **observations?**: [`WindowObservations`](/agentfootprint/api/generated/interfaces/WindowObservations.md)

Defined in: [src/core/agent/window/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L217)

What the last-tool-result pin did on this visit (9.57.0). Present only
when it did something: held a turn, turned one away at the ceiling, or
stood down.

See [WindowObservations](/agentfootprint/api/generated/interfaces/WindowObservations.md). An agent with `keepLastToolResults: false`
— or one whose window held no pinnable tool result — never carries this
key, so its records are the exact shape they were before 9.57.0.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`observations`](/agentfootprint/api/generated/interfaces/WindowRecord.md#observations)

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:190](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L190)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`refusals`](/agentfootprint/api/generated/interfaces/WindowRecord.md#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L185)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedMessageCount`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L183)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedStageIds`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids)

***

### strategy

> `readonly` **strategy**: `"sliding-window"`

Defined in: [src/core/agent/window/types.ts:324](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L324)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`strategy`](/agentfootprint/api/generated/interfaces/WindowRecord.md#strategy)

***

### turnsAfter

> `readonly` **turnsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:329](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L329)

***

### turnsBefore

> `readonly` **turnsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:328](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L328)

Turns in the window before / after this visit. Counted, not estimated.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L188)

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsAfter`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/window/types.ts#L187)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsBefore`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsbefore)
