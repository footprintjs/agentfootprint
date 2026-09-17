---
title: InputRequestDeclaration
---

# Interface: InputRequestDeclaration

Defined in: [src/core/inputRequest.ts:10](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L10)

## Extended by

- [`AwaitingInput`](/docs/api/interfaces/AwaitingInput)

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L17)

Opaque JSON authored by the collecting tool, never editable by the reply.

***

### fields

> `readonly` **fields**: readonly [`InputField`](/docs/api/interfaces/InputField)[]

Defined in: [src/core/inputRequest.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L13)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/inputRequest.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L11)

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/inputRequest.ts:12](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L12)

***

### supplied?

> `readonly` `optional` **supplied?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L15)

Values the collection tool already knows; never labelled as a person's answer.
