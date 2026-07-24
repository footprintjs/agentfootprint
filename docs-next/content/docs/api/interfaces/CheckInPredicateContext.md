---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L180)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L186)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L182)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L184)

This tool invocation's id.
