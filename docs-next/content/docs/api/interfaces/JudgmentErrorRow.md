---
title: JudgmentErrorRow
---

# Interface: JudgmentErrorRow

Defined in: [src/core/agent/findings/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L271)

The judge was asked and produced no answer (9.104.0): the provider's
status and error text (the PROVIDER's words, not the model's — allowed on
the record) and the latency spent. Never a guessed standing: a failed
judgment is an absent judgment with a reason.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L281)

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:277](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L277)

The classifier's port name; the model string is unknown when the call failed.

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment-error"`

Defined in: [src/core/agent/findings/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L272)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L280)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/findings/types.ts:279](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L279)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L275)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/findings/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L278)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L273)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L274)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L288)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
