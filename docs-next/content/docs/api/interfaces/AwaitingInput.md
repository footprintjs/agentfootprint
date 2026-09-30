---
title: AwaitingInput
---

# Interface: AwaitingInput

Defined in: src/core/inputRequest.ts:74

The stamped request as the person, the model and the durable pause read it — never the `absence`.

## Extends

- `Omit`\<[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration), `"absence"`\>

## Properties

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/core/inputRequest.ts:20

Opaque JSON authored by the collecting tool, never editable by the reply.

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`context`](/docs/api/interfaces/InputRequestDeclaration#context)

***

### fields

> `readonly` **fields**: readonly [`InputField`](/docs/api/interfaces/InputField)[]

Defined in: src/core/inputRequest.ts:16

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`fields`](/docs/api/interfaces/InputRequestDeclaration#fields)

***

### id

> `readonly` **id**: `string`

Defined in: src/core/inputRequest.ts:14

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`id`](/docs/api/interfaces/InputRequestDeclaration#id)

***

### missing

> `readonly` **missing**: readonly `string`[]

Defined in: src/core/inputRequest.ts:80

***

### origin

> `readonly` **origin**: `object`

Defined in: src/core/inputRequest.ts:83

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

Defined in: src/core/inputRequest.ts:79

***

### question

> `readonly` **question**: `string`

Defined in: src/core/inputRequest.ts:15

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`question`](/docs/api/interfaces/InputRequestDeclaration#question)

***

### refused?

> `readonly` `optional` **refused?**: [`InputRefusal`](/docs/api/interfaces/InputRefusal)

Defined in: src/core/inputRequest.ts:48

The previous answer to this ask was REFUSED, and why: the app
validated what the person gave, turned it down, and asks again. Carried
on the awaiting-input shape the person receives — the checkpoint's
`pauseData`, the pause outcome, the `pause.request` event — so a UI can
say "Your answer '…' was not accepted: <reason>" instead of repeating
the same question in silence. The reason is the APP'S words; the library
never writes one. `answer` is optional and judged against `fields` like
any answer; `null` is the field omitted.

#### Inherited from

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`refused`](/docs/api/interfaces/InputRequestDeclaration#refused)

***

### repeat?

> `readonly` `optional` **repeat?**: [`InputRepeat`](/docs/api/interfaces/InputRepeat)

Defined in: src/core/inputRequest.ts:82

Present only on a re-ask — see `InputRepeat`.

***

### requestId

> `readonly` **requestId**: `string`

Defined in: src/core/inputRequest.ts:77

Runtime-stamped token, distinct from the author's reusable declaration id.

***

### status

> `readonly` **status**: `"awaiting_input"`

Defined in: src/core/inputRequest.ts:75

***

### supplied

> `readonly` **supplied**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: src/core/inputRequest.ts:78

Values the collection tool already knows; never labelled as a person's answer.

#### Overrides

[`InputRequestDeclaration`](/docs/api/interfaces/InputRequestDeclaration).[`supplied`](/docs/api/interfaces/InputRequestDeclaration#supplied)
