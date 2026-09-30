---
title: JudgmentErrorRow
---

# Interface: JudgmentErrorRow

Defined in: [src/core/agent/findings/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L289)

The judge was asked and produced no answer (9.104.0): the provider's
status and error text (the PROVIDER's words, not the model's — allowed on
the record) and the latency spent. Never a guessed standing: a failed
judgment is an absent judgment with a reason.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:299](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L299)

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:295](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L295)

The classifier's port name; the model string is unknown when the call failed.

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment-error"`

Defined in: [src/core/agent/findings/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L290)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:298](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L298)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/findings/types.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L297)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L293)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/findings/types.ts:296](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L296)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:291](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L291)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L292)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:306](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L306)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
