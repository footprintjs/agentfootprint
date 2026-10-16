---
title: AnswerToolCall
---

# Interface: AnswerToolCall

Defined in: [src/answer-validation/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L45)

One tool call of THIS run, as the loop reported it on `stream.tool_end`.
Names and ids only: arguments and results are never in it. The call's
result message carries the same `callId` (`LLMMessage.toolCallId`).

## Properties

### callId

> `readonly` **callId**: `string`

Defined in: [src/answer-validation/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L48)

***

### name

> `readonly` **name**: `string`

Defined in: [src/answer-validation/types.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L47)

The tool name the model called (a registered name, or an unknown one it made up).

***

### outcome

> `readonly` **outcome**: `"ok"` \| `"error"` \| `"not-run"`

Defined in: [src/answer-validation/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L56)

`ok`: the tool ran and returned. `error`: it threw, declared `failure`,
`denied` or `invalid`, or could not run as written (an unknown name,
rejected arguments, a missing consent). `not-run`: it never ran (a
permission policy, an `onToolCall` link or a person declined it, or a
paused batch never dispatched it).
