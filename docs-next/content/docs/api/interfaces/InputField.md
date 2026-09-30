---
title: InputField
---

# Interface: InputField

Defined in: [src/core/inputRequest.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L16)

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/core/inputRequest.ts:20](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L20)

***

### enum?

> `readonly` `optional` **enum?**: readonly [`InputValue`](/docs/api/type-aliases/InputValue)[]

Defined in: [src/core/inputRequest.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L21)

***

### format?

> `readonly` `optional` **format?**: [`TimeFormat`](/docs/api/type-aliases/TimeFormat)

Defined in: [src/core/inputRequest.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L33)

A TIME field (time design § 6.1): the library checks the answer before the
app sees it. `'instant'` — an ISO 8601 date-time with its offset
(`2026-10-09T08:00-07:00`); `'time-range'` — an ISO 8601 interval
`from/to` of two such instants, `from` before `to`; `'zone'` — an IANA
zone name. The value stays a string on the wire, so refused unless
`type: 'string'`. An answer that fails the check is not taken: the resume
door asks again with `refused: { answer, reason }` (the reason a catalog
sentence, `defaultTimeAskMessages`) and `repeat: { count }`, and nothing
runs. A choice or a supplied value that fails it is refused at definition.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/inputRequest.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L17)

***

### labels?

> `readonly` `optional` **labels?**: readonly `string`[]

Defined in: [src/core/inputRequest.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L39)

One label per `enum` choice, in its order — what a person reads beside
the value (`'Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT'`); the value is what the
answer carries. Needs `enum`.

***

### required?

> `readonly` `optional` **required?**: `boolean`

Defined in: [src/core/inputRequest.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L19)

***

### strict?

> `readonly` `optional` **strict?**: `boolean`

Defined in: [src/core/inputRequest.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L45)

A time field's choices are the only answers. Without it a `format` field
with `enum` keeps free entry open: any answer the format check takes is
taken. Needs `format` and `enum`.

***

### type

> `readonly` **type**: `"string"` \| `"number"` \| `"boolean"`

Defined in: [src/core/inputRequest.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L18)
