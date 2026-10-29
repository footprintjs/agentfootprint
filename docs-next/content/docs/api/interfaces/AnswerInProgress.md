---
title: AnswerInProgress
---

# Interface: AnswerInProgress

Defined in: [src/semantics/coverage/answer.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/answer.ts#L74)

One declaring call's in-progress items, as the answer's limits carry them —
the tool, the call, and what its read found still running, as declared: the
data twin of that call's lines under "In progress (outcome not known yet)".

## Properties

### items

> `readonly` **items**: readonly [`InProgressItem`](/docs/api/interfaces/InProgressItem)[]

Defined in: [src/semantics/coverage/answer.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/answer.ts#L77)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/semantics/coverage/answer.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/answer.ts#L76)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/semantics/coverage/answer.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/coverage/answer.ts#L75)
