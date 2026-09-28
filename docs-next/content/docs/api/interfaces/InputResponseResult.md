---
title: InputResponseResult
---

# Interface: InputResponseResult

Defined in: [src/core/inputRequest.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L70)

The dedicated collecting tool's result; it contains inputs, not observations.

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L75)

***

### origin

> `readonly` **origin**: `object`

Defined in: [src/core/inputRequest.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L76)

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

Defined in: [src/core/inputRequest.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L74)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/inputRequest.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L72)

***

### status

> `readonly` **status**: `"input_received"`

Defined in: [src/core/inputRequest.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L71)

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L73)
