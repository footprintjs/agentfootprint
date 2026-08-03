[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInPredicateContext

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:180](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/checkin.ts#L180)

Context handed to a [CheckInDemand](/agentfootprint/api/generated/type-aliases/CheckInDemand.md) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/checkin.ts:186](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/checkin.ts#L186)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:182](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/checkin.ts#L182)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:184](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/checkin.ts#L184)

This tool invocation's id.
