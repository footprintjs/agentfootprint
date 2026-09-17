---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:263](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L263)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L269)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L265)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L267)

This tool invocation's id.
