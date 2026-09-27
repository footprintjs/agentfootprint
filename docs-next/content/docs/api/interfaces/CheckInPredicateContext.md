---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L268)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L274)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L270)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L272)

This tool invocation's id.
