---
title: AwaitingInput
---

# Interface: AwaitingInput

Defined in: [src/core/inputRequest.ts:40](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L40)

The stamped request as the person, the model and the durable pause read it — never the `absence`.

## Extends

- `Omit`\<[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration), `"absence"`\>

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:20](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L20)

Opaque JSON authored by the collecting tool, never editable by the reply.

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`context`](/docs/api/interfaces/InputRequestDeclaration#context)

***

### fields

> `readonly` **fields**: readonly [`InputField`](/docs/api/interfaces/InputField)[]

Defined in: [src/core/inputRequest.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L16)

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`fields`](/docs/api/interfaces/InputRequestDeclaration#fields)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/inputRequest.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L14)

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`id`](/docs/api/interfaces/InputRequestDeclaration#id)

***

### missing

> `readonly` **missing**: readonly `string`[]

Defined in: [src/core/inputRequest.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L46)

***

### origin

> `readonly` **origin**: `object`

Defined in: [src/core/inputRequest.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L47)

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

Defined in: [src/core/inputRequest.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L45)

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/inputRequest.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L15)

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`question`](/docs/api/interfaces/InputRequestDeclaration#question)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/inputRequest.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L43)

Runtime-stamped token, distinct from the author's reusable declaration id.

***

### status

> `readonly` **status**: `"awaiting_input"`

Defined in: [src/core/inputRequest.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L41)

***

### supplied

> `readonly` **supplied**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:44](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L44)

Values the collection tool already knows; never labelled as a person's answer.

#### Overrides

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`supplied`](/docs/api/interfaces/InputRequestDeclaration#supplied)
