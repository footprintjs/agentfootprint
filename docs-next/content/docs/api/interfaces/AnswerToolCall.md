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

Defined in: [src/answer-validation/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L70)

`ok`: the tool ran and returned — including a call that paused for a
person, whose answer on `resume()` is its result. `error`: the tool ran,
and it threw or declared `failure`, `denied` or `invalid`. `not-run`: the
tool never ran — a permission policy, an `onToolCall` link or a person
declined it, a paused batch never dispatched it, or it could not run as
written (an unknown name, rejected arguments, a missing consent or
credential), read off `stream.tool_end.entered` by
`semantics/toolRan.ts` · `toolRanOf`. Example: the model calls
`reboot_host`, which no tool is named: `{ name: 'reboot_host', outcome: 'not-run' }`.
