---
title: JudgmentErrorRow
---

# Interface: JudgmentErrorRow

Defined in: [src/core/agent/findings/types.ts:310](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L310)

The judge was asked and produced no answer (9.104.0): the provider's
status and error text (the PROVIDER's words, not the model's — allowed on
the record) and the latency spent. Never a guessed standing: a failed
judgment is an absent judgment with a reason.

## Properties

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/core/agent/findings/types.ts:313](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L313)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L321)

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:317](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L317)

The classifier's port name; the model string is unknown when the call failed.

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment-error"`

Defined in: [src/core/agent/findings/types.ts:311](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L311)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:320](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L320)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/findings/types.ts:319](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L319)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:315](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L315)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/findings/types.ts:318](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L318)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:312](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L312)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:314](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L314)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:328](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L328)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
