---
title: CheckInPredicateContext
---

# Interface: CheckInPredicateContext

Defined in: src/core/checkin.ts:180

Context handed to a [CheckInDemand](/docs/api/type-aliases/CheckInDemand) predicate.

## Properties

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: src/core/checkin.ts:186

The conversation so far (system, user, prior tool results).

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/checkin.ts:182

The current ReAct iteration.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: src/core/checkin.ts:184

This tool invocation's id.
