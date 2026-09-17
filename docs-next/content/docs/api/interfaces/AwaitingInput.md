---
title: AwaitingInput
---

# Interface: AwaitingInput

Defined in: [src/core/inputRequest.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L19)

## Extends

- [`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration)

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L17)

Opaque JSON authored by the collecting tool, never editable by the reply.

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`context`](/docs/api/interfaces/InputRequestDeclaration#context)

***

### fields

> `readonly` **fields**: readonly [`InputField`](/docs/api/interfaces/InputField)[]

Defined in: [src/core/inputRequest.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L13)

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`fields`](/docs/api/interfaces/InputRequestDeclaration#fields)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/inputRequest.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L11)

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`id`](/docs/api/interfaces/InputRequestDeclaration#id)

***

### missing

> `readonly` **missing**: readonly `string`[]

Defined in: [src/core/inputRequest.ts:25](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L25)

***

### origin

> `readonly` **origin**: `object`

Defined in: [src/core/inputRequest.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L26)

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

Defined in: [src/core/inputRequest.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L24)

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/inputRequest.ts:12](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L12)

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`question`](/docs/api/interfaces/InputRequestDeclaration#question)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/inputRequest.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L22)

Runtime-stamped token, distinct from the author's reusable declaration id.

***

### status

> `readonly` **status**: `"awaiting_input"`

Defined in: [src/core/inputRequest.ts:20](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L20)

***

### supplied

> `readonly` **supplied**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:23](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L23)

Values the collection tool already knows; never labelled as a person's answer.

#### Overrides

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`supplied`](/docs/api/interfaces/InputRequestDeclaration#supplied)
