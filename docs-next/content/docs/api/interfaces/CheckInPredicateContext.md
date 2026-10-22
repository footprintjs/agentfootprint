---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: [src/core/checkin.ts:337](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L337)

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/checkin.ts:343](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L343)

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:339](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L339)

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/checkin.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L341)

This tool invocation's id.
