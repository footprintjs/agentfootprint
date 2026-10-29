---
title: AnswerToolCall
---

# Interface: AnswerToolCall

Defined in: [src/answer-validation/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L55)

One tool call of THIS run, as the loop reported it on `stream.tool_end`.
Names and ids only: arguments and results are never in it. The call's
result message carries the same `callId` (`LLMMessage.toolCallId`).

## Properties

### callId

> `readonly` **callId**: `string`

Defined in: [src/answer-validation/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L58)

***

### name

> `readonly` **name**: `string`

Defined in: [src/answer-validation/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L57)

The tool name the model called (a registered name, or an unknown one it made up).

***

### outcome

> `readonly` **outcome**: `"ok"` \| `"error"` \| `"not-run"`

Defined in: [src/answer-validation/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L67)

`ok`: the tool ran and returned — including a call that paused for a
person, whose answer on `resume()` is its result. `error`: it threw, declared `failure`,
`denied` or `invalid`, or could not run as written (an unknown name,
rejected arguments, a missing consent). `not-run`: it never ran (a
permission policy, an `onToolCall` link or a person declined it, or a
paused batch never dispatched it).
