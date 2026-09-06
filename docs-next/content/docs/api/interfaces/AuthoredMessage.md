---
title: AuthoredMessage
---

# Interface: AuthoredMessage

Defined in: [src/lib/saidByPerson.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/saidByPerson.ts#L71)

The fields authorship is decided from — structural, so both
`LLMMessage` (the wire shape) and `InjectionContext.history[n]` (the
read-only view a predicate gets) satisfy it unchanged.

`injectedBy` is `unknown` here on purpose: this file only ever asks whether
the marker is PRESENT, and typing its interior would make a leaf that must
import nothing into a mirror that can drift.

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/lib/saidByPerson.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/saidByPerson.ts#L73)

***

### injectedBy?

> `readonly` `optional` **injectedBy?**: `unknown`

Defined in: [src/lib/saidByPerson.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/saidByPerson.ts#L74)

***

### role

> `readonly` **role**: `string`

Defined in: [src/lib/saidByPerson.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/saidByPerson.ts#L72)
