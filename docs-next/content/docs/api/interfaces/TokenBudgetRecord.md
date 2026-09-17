---
title: TokenBudgetRecord
---

# Interface: TokenBudgetRecord

Defined in: [src/core/agent/window/types.ts:333](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L333)

What one OVER-BUDGET visit to `tokenBudget` put in the ledger.

## Extends

- [`WindowRecord`](/docs/api/interfaces/WindowRecord)

## Properties

### droppedObservations?

> `readonly` `optional` **droppedObservations?**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L207)

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

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`droppedObservations`](/docs/api/interfaces/WindowRecord#droppedobservations)

***

### droppedStandings?

> `readonly` `optional` **droppedStandings?**: readonly `object`[]

Defined in: [src/core/agent/window/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L246)

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

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`droppedStandings`](/docs/api/interfaces/WindowRecord#droppedstandings)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L181)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`iteration`](/docs/api/interfaces/WindowRecord#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:342](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L342)

How many recent turns were off-limits to this visit.

***

### ledgerFacts?

> `readonly` `optional` **ledgerFacts?**: [`WindowObservations`](/docs/api/interfaces/WindowObservations)

Defined in: [src/core/agent/window/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L232)

What the ledger-fact pin did on this visit (9.102.0). Present only when
it did something: held a turn, turned one away at the ceiling, or stood
down — and only on an ARMED agent (`.findings()` configured), so an
unarmed agent's records are the exact shape they were before.

The same [WindowObservations](/docs/api/interfaces/WindowObservations) shape as `observations`, a second
block rather than a merged one: `limit` there is `keepLastToolResults`,
here it is `keepLedgerFacts`, and a reader adding up what each pin cost
needs them apart. The stand-down reads BOTH blocks: when the two previous
visits removed nothing and named only pins (`'last-tool-result'` and/or
`'ledger-fact'`), the fact pins release for this visit and this block
says so (`{ pinned: [], yielded: 0, limit, standDown: true }`).

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`ledgerFacts`](/docs/api/interfaces/WindowRecord#ledgerfacts)

***

### measuredTokens

> `readonly` **measuredTokens**: `number`

Defined in: [src/core/agent/window/types.ts:336](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L336)

Adapter-reported input tokens of the last call — what tripped the check.

***

### observations?

> `readonly` `optional` **observations?**: [`WindowObservations`](/docs/api/interfaces/WindowObservations)

Defined in: [src/core/agent/window/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L217)

What the last-tool-result pin did on this visit (9.57.0). Present only
when it did something: held a turn, turned one away at the ceiling, or
stood down.

See [WindowObservations](/docs/api/interfaces/WindowObservations). An agent with `keepLastToolResults: false`
— or one whose window held no pinnable tool result — never carries this
key, so its records are the exact shape they were before 9.57.0.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`observations`](/docs/api/interfaces/WindowRecord#observations)

***

### overBudget

> `readonly` **overBudget**: `boolean`

Defined in: [src/core/agent/window/types.ts:340](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L340)

True when the measurement was over budget (a drop was attempted).

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/docs/api/interfaces/WindowRefusal)[]

Defined in: [src/core/agent/window/types.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L190)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`refusals`](/docs/api/interfaces/WindowRecord#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L185)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedMessageCount`](/docs/api/interfaces/WindowRecord#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L183)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedStageIds`](/docs/api/interfaces/WindowRecord#removedstageids)

***

### strategy

> `readonly` **strategy**: `"token-budget"`

Defined in: [src/core/agent/window/types.ts:334](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L334)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`strategy`](/docs/api/interfaces/WindowRecord#strategy)

***

### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Defined in: [src/core/agent/window/types.ts:338](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L338)

The budget it was compared against.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L188)

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsAfter`](/docs/api/interfaces/WindowRecord#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L187)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsBefore`](/docs/api/interfaces/WindowRecord#windowcharsbefore)
