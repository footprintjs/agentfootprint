---
title: BasisRow
---

# Interface: BasisRow

Defined in: [src/core/agent/findings/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L132)

The model's basis for ONE tool call, filed before the call runs.

## Properties

### basis

> `readonly` **basis**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L137)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L138)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L136)

***

### kind

> `readonly` **kind**: `"basis"`

Defined in: [src/core/agent/findings/types.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L133)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/findings/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L152)

How many entries of the same `_findings` value `splitFindings` dropped as
malformed. A count about the emission, present only when non-zero — it is
what `findings.declared` reports, and the row is the only place a count
about THIS declaration can live (the writer emits from rows alone).

***

### predicts?

> `readonly` `optional` **predicts?**: `string`

Defined in: [src/core/agent/findings/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L145)

***

### proposition?

> `readonly` `optional` **proposition?**: `string`

Defined in: [src/core/agent/findings/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L144)

The declared proposition and prediction, each at most `PROPOSITION_CHARS`
with any cut stated in the text itself. Present only when declared —
never defaulted, never inferred from the call's arguments.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L134)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L135)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L159)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
