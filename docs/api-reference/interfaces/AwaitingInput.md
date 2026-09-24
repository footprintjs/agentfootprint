[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AwaitingInput

# Interface: AwaitingInput

Defined in: [src/core/inputRequest.ts:40](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L40)

The stamped request as the person, the model and the durable pause read it — never the `absence`.

## Extends

- `Omit`\<[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md), `"absence"`\>

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:20](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L20)

Opaque JSON authored by the collecting tool, never editable by the reply.

#### Inherited from

[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md).[`context`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md#context)

***

### fields

> `readonly` **fields**: readonly [`InputField`](/agentfootprint/api/generated/interfaces/InputField.md)[]

Defined in: [src/core/inputRequest.ts:16](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L16)

#### Inherited from

[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md).[`fields`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md#fields)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/inputRequest.ts:14](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L14)

#### Inherited from

[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md).[`id`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md#id)

***

### missing

> `readonly` **missing**: readonly `string`[]

Defined in: [src/core/inputRequest.ts:46](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L46)

***

### origin

> `readonly` **origin**: `object`

Defined in: [src/core/inputRequest.ts:47](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L47)

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

Defined in: [src/core/inputRequest.ts:45](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L45)

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/inputRequest.ts:15](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L15)

#### Inherited from

[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md).[`question`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md#question)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/core/inputRequest.ts:43](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L43)

Runtime-stamped token, distinct from the author's reusable declaration id.

***

### status

> `readonly` **status**: `"awaiting_input"`

Defined in: [src/core/inputRequest.ts:41](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L41)

***

### supplied

> `readonly` **supplied**: `Readonly`\<`Record`\<`string`, [`InputValue`](/agentfootprint/api/generated/type-aliases/InputValue.md)\>\>

Defined in: [src/core/inputRequest.ts:44](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/inputRequest.ts#L44)

Values the collection tool already knows; never labelled as a person's answer.

#### Overrides

[`InputRequestDeclaration`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md).[`supplied`](/agentfootprint/api/generated/interfaces/InputRequestDeclaration.md#supplied)
