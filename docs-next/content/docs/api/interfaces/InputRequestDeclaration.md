---
title: InputRequestDeclaration
---

# Interface: InputRequestDeclaration

Defined in: [src/core/inputRequest.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L13)

## Properties

### absence?

> `readonly` `optional` **absence?**: [`ToolAbsence`](/docs/api/interfaces/ToolAbsence)

Defined in: [src/core/inputRequest.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L37)

What the tool LOOKED AT before it asked (9.114.0): the envelope `absent()`
returns, when a lookup found nothing and raises this request about the
miss. Recognized at raise time by the one recognizer
(`agent/coverage/absent.ts` · `readAbsence`) — anything it does not read
is refused, and `null` is the field omitted — and filed by the dispatch
door at the raise, before the
checkpoint is returned: the same `tools.absent` event and
`coverageDeclared` row a RETURNED absence files
(`agent/stages/toolCalls.ts` · `declareRaisedAbsence`). Data for the
record, not for the ask: it never rides the awaiting-input shape or the
paused call's served result, and nothing on resume reads it, so the
pending question says the miss only if `question` says it in words.
Under `.limitsTravelWithTheAnswer()` the final answer's limits block
carries it, as it does a returned miss.

***

### context?

> `readonly` `optional` **context?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/inputRequest.ts:20](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L20)

Opaque JSON authored by the collecting tool, never editable by the reply.

***

### fields

> `readonly` **fields**: readonly [`InputField`](/docs/api/interfaces/InputField)[]

Defined in: [src/core/inputRequest.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L16)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/inputRequest.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L14)

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/inputRequest.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L15)

***

### supplied?

> `readonly` `optional` **supplied?**: `Readonly`\<`Record`\<`string`, [`InputValue`](/docs/api/type-aliases/InputValue)\>\>

Defined in: [src/core/inputRequest.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/core/inputRequest.ts#L18)

Values the collection tool already knows; never labelled as a person's answer.
