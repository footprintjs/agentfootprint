---
title: AuthoredMessage
---

# Interface: AuthoredMessage

Defined in: src/lib/saidByPerson.ts:88

The fields authorship is decided from — structural, so both
`LLMMessage` (the wire shape) and `InjectionContext.history[n]` (the
read-only view a predicate gets) satisfy it unchanged.

`injectedBy` is `unknown` here on purpose: this file only ever asks whether
the marker is PRESENT, and typing its interior would make a leaf that must
import nothing into a mirror that can drift.

## Properties

### content

> `readonly` **content**: `string`

Defined in: src/lib/saidByPerson.ts:90

***

### ephemeral?

> `readonly` `optional` **ephemeral?**: `unknown`

Defined in: src/lib/saidByPerson.ts:93

`true` on a line composed for ONE request (`LLMMessage.ephemeral`) — never a person's turn.

***

### injectedBy?

> `readonly` `optional` **injectedBy?**: `unknown`

Defined in: src/lib/saidByPerson.ts:91

***

### role

> `readonly` **role**: `string`

Defined in: src/lib/saidByPerson.ts:89
