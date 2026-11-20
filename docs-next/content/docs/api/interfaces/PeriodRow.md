---
title: PeriodRow
---

# Interface: PeriodRow

Defined in: [src/semantics/coverage/periodRow.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L35)

The results layer's verdict on ONE call's period — a row on the one honesty
ledger (`AgentState.findingsLedger`, `kind: 'period'`), filed by the results
subflow at the loop head (`../../core/agent/results/subflow.ts`), never by the model.

- `verdict` — `period.ts` · `periodVerdict` over the period the call's result
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

Defined in: [src/semantics/coverage/periodRow.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L48)

The argument the tool's `ToolPeriod` names — present only when it declares one.

***

### beyondRetention?

> `readonly` `optional` **beyondRetention?**: `true`

Defined in: [src/semantics/coverage/periodRow.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L57)

`period-beyond-retention` — refused as, or read as, wholly older than the tool's source keeps.

***

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/semantics/coverage/periodRow.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L36)

***

### differs?

> `readonly` `optional` **differs?**: `PeriodDiffers`

Defined in: [src/semantics/coverage/periodRow.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L53)

`period-differs-from-asked { missing, extra }` — the read differs from the asked range (or, for a window the model chose, from the person's).

***

### held?

> `readonly` `optional` **held?**: `object`

Defined in: [src/semantics/coverage/periodRow.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L70)

The time the source holds, when it holds none or only part of what the
call asked about (`verdict` `not-held` / `partly-held`) — the `queried` and
`held` spans of the declared period that verdict came from, as the tool
declared them. Filed only under `.time()`, where the served time line
hands the model this conclusion in the person's zone (`timeLimits.ts` ·
`heldLine`) and the evidence gate spells it (`time/forms.ts` ·
`timeFormsOf`, its `held` source): the model never converts a source's
UTC instants itself.

#### held

> `readonly` **held**: `object`

##### held.from

> `readonly` **from**: `string`

##### held.to

> `readonly` **to**: `string`

#### queried

> `readonly` **queried**: `object`

##### queried.from

> `readonly` **from**: `string`

##### queried.to

> `readonly` **to**: `string`

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/semantics/coverage/periodRow.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L45)

The iteration of the batch the call ran in.

***

### kind

> `readonly` **kind**: `"period"`

Defined in: [src/semantics/coverage/periodRow.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L39)

***

### nativePeriodServed?

> `readonly` `optional` **nativePeriodServed?**: `true`

Defined in: [src/semantics/coverage/periodRow.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L38)

Legacy draft proof that a native result was served, before the settlement ledger.

***

### partlyBeyondRetention?

> `readonly` `optional` **partlyBeyondRetention?**: `true`

Defined in: [src/semantics/coverage/periodRow.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L59)

`partly-beyond-retention` — the read crosses the edge of what the source keeps; `verdict` decides.

***

### shifted?

> `readonly` `optional` **shifted?**: `object`

Defined in: [src/semantics/coverage/periodRow.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L55)

`period-shifted` — the call's look-back ran as sent, `byMs` after the turn's `now`.

#### byMs

> `readonly` **byMs**: `number`

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/semantics/coverage/periodRow.ts:42](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L42)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/semantics/coverage/periodRow.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L43)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/semantics/coverage/periodRow.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L41)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### verdict

> `readonly` **verdict**: `"unknown"` \| `"covered"` \| `"partly-held"` \| `"not-held"` \| `"undeclared"`

Defined in: [src/semantics/coverage/periodRow.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/periodRow.ts#L46)
