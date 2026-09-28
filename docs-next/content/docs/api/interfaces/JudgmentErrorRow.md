---
title: JudgmentErrorRow
---

# Interface: JudgmentErrorRow

Defined in: [src/core/agent/findings/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L280)

The judge was asked and produced no answer (9.104.0): the provider's
status and error text (the PROVIDER's words, not the model's — allowed on
the record) and the latency spent. Never a guessed standing: a failed
judgment is an absent judgment with a reason.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L290)

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L286)

The classifier's port name; the model string is unknown when the call failed.

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment-error"`

Defined in: [src/core/agent/findings/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L281)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L289)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/findings/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L288)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L284)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/findings/types.ts:287](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L287)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L282)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:283](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L283)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L297)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
