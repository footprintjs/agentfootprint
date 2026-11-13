---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:355](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L355)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:361](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L361)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:357](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L357)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:359](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L359)

This tool invocation's id.
