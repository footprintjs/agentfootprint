[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / JudgmentErrorRow

# Interface: JudgmentErrorRow

Defined in: [src/core/agent/findings/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L242)

The judge was asked and produced no answer (9.104.0): the provider's
status and error text (the PROVIDER's words, not the model's — allowed on
the record) and the latency spent. Never a guessed standing: a failed
judgment is an absent judgment with a reason.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L252)

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:248](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L248)

The classifier's port name; the model string is unknown when the call failed.

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment-error"`

Defined in: [src/core/agent/findings/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L243)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L251)

***

### message

> `readonly` **message**: `string`

Defined in: [src/core/agent/findings/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L250)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L246)

***

### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/core/agent/findings/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L249)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L244)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L245)
