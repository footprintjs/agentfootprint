---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:350](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L350)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:356](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L356)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:352](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L352)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:354](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L354)

This tool invocation's id.
