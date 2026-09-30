---
title: InputResponseResult
---

# Interface: InputResponseResult

Defined in: src/core/inputRequest.ts:106

The dedicated collecting tool's result; it contains inputs, not observations.

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/core/inputRequest.ts:111

***

### origin

> `readonly` **origin**: `object`

Defined in: src/core/inputRequest.ts:112

#### offeredSkillIds?

> `readonly` `optional` **offeredSkillIds?**: readonly `string`[]

#### originalRequest

> `readonly` **originalRequest**: `string`

#### skillId?

> `readonly` `optional` **skillId?**: `string`

#### toolCallId

> `readonly` **toolCallId**: `string`

The call that raised the request. For the inputs layer's own batch ask
(`context.agentfootprint.ask === 'arguments'`, honesty layer 2) no single
call raised it — the library asked before anything in the batch ran — so
this names the batch's FIRST asked call, and `context.agentfootprint.fields`
lists every call each field is for.

***

### origins

> `readonly` **origins**: `Readonly`\<`Record`\<`string`, `"declaration"` \| `"response"`\>\>

Defined in: src/core/inputRequest.ts:110

***

### requestId

> `readonly` **requestId**: `string`

Defined in: src/core/inputRequest.ts:108

***

### status

> `readonly` **status**: `"input_received"`

Defined in: src/core/inputRequest.ts:107

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: src/core/inputRequest.ts:109
