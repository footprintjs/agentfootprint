---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L375)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:381](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L381)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:377](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L377)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:379](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L379)

This tool invocation's id.
