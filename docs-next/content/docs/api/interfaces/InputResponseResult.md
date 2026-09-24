---
title: InputResponseResult
---

# Interface: InputResponseResult

Defined in: [src/core/inputRequest.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L63)

The dedicated collecting tool's result; it contains inputs, not observations.

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L68)

***

### origin

> `readonly` **origin**: `object`

Defined in: [src/core/inputRequest.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L69)

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

Defined in: [src/core/inputRequest.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L67)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/inputRequest.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L65)

***

### status

> `readonly` **status**: `"input_received"`

Defined in: [src/core/inputRequest.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L64)

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L66)
