---
title: BasisRow
---

# Interface: BasisRow

Defined in: [src/core/agent/findings/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L116)

The model's basis for ONE tool call, filed before the call runs.

## Properties

### basis

> `readonly` **basis**: [`Basis`](/docs/api/type-aliases/Basis)

Defined in: [src/core/agent/findings/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L121)

***

### expect?

> `readonly` `optional` **expect?**: [`Expect`](/docs/api/type-aliases/Expect)

Defined in: [src/core/agent/findings/types.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L122)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L120)

***

### kind

> `readonly` **kind**: `"basis"`

Defined in: [src/core/agent/findings/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L117)

***

### malformed?

> `readonly` `optional` **malformed?**: `number`

Defined in: [src/core/agent/findings/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L136)

How many entries of the same `_findings` value `splitFindings` dropped as
malformed. A count about the emission, present only when non-zero — it is
what `findings.declared` reports, and the row is the only place a count
about THIS declaration can live (the writer emits from rows alone).

***

### predicts?

> `readonly` `optional` **predicts?**: `string`

Defined in: [src/core/agent/findings/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L129)

***

### proposition?

> `readonly` `optional` **proposition?**: `string`

Defined in: [src/core/agent/findings/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L128)

The declared proposition and prediction, each at most `PROPOSITION_CHARS`
with any cut stated in the text itself. Present only when declared —
never defaulted, never inferred from the call's arguments.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L118)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L119)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L143)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
