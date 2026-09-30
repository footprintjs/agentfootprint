---
title: PeriodRow
---

# Interface: PeriodRow

Defined in: [src/core/agent/coverage/period.ts:649](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L649)

The results layer's verdict on ONE call's period — a row on the one honesty
ledger (`AgentState.findingsLedger`, `kind: 'period'`), filed by the results
subflow at the loop head (`../results/subflow.ts`), never by the model.

- `verdict` — [periodVerdict](/docs/api/functions/periodVerdict) over the period the call's result
  declared (the least held, when it declared more than one), or
  `'undeclared'`: the tool declares a `ToolPeriod` and this result said
  nothing about what its read covered — declared silence, recorded as
  silence.
- `argument` — the argument the tool's `ToolPeriod` names: the join key to
  the inputs layer's `argument` row for the same call (`period: true`), which
  says WHO chose the period, while this row says WHAT the read covered.

The row references the call's coverage row by `toolCallId` and never copies
the instants: the declaration stays in its own key (`coverageDeclared`).
Readers that switch over every row kind must skip one they do not know.

## Properties

### argument?

> `readonly` `optional` **argument?**: `string`

Defined in: [src/core/agent/coverage/period.ts:659](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L659)

The argument the tool's `ToolPeriod` names — present only when it declares one.

***

### beyondRetention?

> `readonly` `optional` **beyondRetention?**: `true`

Defined in: [src/core/agent/coverage/period.ts:668](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L668)

`period-beyond-retention` — refused as, or read as, wholly older than the tool's source keeps.

***

### differs?

> `readonly` `optional` **differs?**: `PeriodDiffers`

Defined in: [src/core/agent/coverage/period.ts:664](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L664)

`period-differs-from-asked { missing, extra }` — the read differs from the asked range (or, for a window the model chose, from the person's).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/coverage/period.ts:656](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L656)

The iteration of the batch the call ran in.

***

### kind

> `readonly` **kind**: `"period"`

Defined in: [src/core/agent/coverage/period.ts:650](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L650)

***

### partlyBeyondRetention?

> `readonly` `optional` **partlyBeyondRetention?**: `true`

Defined in: [src/core/agent/coverage/period.ts:670](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L670)

`partly-beyond-retention` — the read crosses the edge of what the source keeps; `verdict` decides.

***

### shifted?

> `readonly` `optional` **shifted?**: `object`

Defined in: [src/core/agent/coverage/period.ts:666](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L666)

`period-shifted` — the call's look-back ran as sent, `byMs` after the turn's `now`.

#### byMs

> `readonly` **byMs**: `number`

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/coverage/period.ts:653](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L653)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/coverage/period.ts:654](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L654)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/agent/coverage/period.ts:652](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L652)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### verdict

> `readonly` **verdict**: `"unknown"` \| `"covered"` \| `"partly-held"` \| `"not-held"` \| `"undeclared"`

Defined in: [src/core/agent/coverage/period.ts:657](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/period.ts#L657)
