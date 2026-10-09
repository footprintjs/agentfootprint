---
title: JudgmentErrorRow
---

# Interface: JudgmentErrorRow

Defined in: [src/core/agent/findings/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L292)

The judge was asked and produced no answer (9.104.0): the provider's
status and error text (the PROVIDER's words, not the model's — allowed on
the record) and the latency spent. Never a guessed standing: a failed
judgment is an absent judgment with a reason.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:302](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L302)

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:298](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L298)

The classifier's port name; the model string is unknown when the call failed.

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment-error"`

Defined in: [src/core/agent/findings/types.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L293)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:301](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L301)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/findings/types.ts:300](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L300)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:296](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L296)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/findings/types.ts:299](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L299)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L294)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:295](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L295)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:309](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L309)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.
