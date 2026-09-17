---
title: InputResponseResult
---

# Interface: InputResponseResult

Defined in: [src/core/inputRequest.ts:42](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L42)

The dedicated collecting tool's result; it contains inputs, not observations.

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L47)

***

### origin

> `readonly` **origin**: `object`

Defined in: [src/core/inputRequest.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L48)

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

Defined in: [src/core/inputRequest.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L46)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/inputRequest.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L44)

***

### status

> `readonly` **status**: `"input_received"`

Defined in: [src/core/inputRequest.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L43)

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L45)
