---
title: InputResponseResult
---

# Interface: InputResponseResult

Defined in: src/core/inputRequest.ts:42

The dedicated collecting tool's result; it contains inputs, not observations.

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/core/inputRequest.ts:47

***

### origin

> `readonly` **origin**: `object`

Defined in: src/core/inputRequest.ts:48

#### offeredSkillIds?

> `readonly` `optional` **offeredSkillIds?**: readonly `string`[]

#### originalRequest

> `readonly` **originalRequest**: `string`

#### skillId?

> `readonly` `optional` **skillId?**: `string`

#### toolCallId

> `readonly` **toolCallId**: `string`

***

### origins

> `readonly` **origins**: `Readonly`\<`Record`\<`string`, `"declaration"` \| `"response"`\>\>

Defined in: src/core/inputRequest.ts:46

***

### requestId

> `readonly` **requestId**: `string`

Defined in: src/core/inputRequest.ts:44

***

### status

> `readonly` **status**: `"input_received"`

Defined in: src/core/inputRequest.ts:43

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: src/core/inputRequest.ts:45
