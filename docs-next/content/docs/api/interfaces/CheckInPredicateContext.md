---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:382](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L382)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:388](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L388)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:384](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L384)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:386](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L386)

This tool invocation's id.
