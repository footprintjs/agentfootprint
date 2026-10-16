---
title: AnswerToolCallsView
---

# Interface: AnswerToolCallsView

Defined in: [src/answer-validation/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L67)

The run's tool calls in landing order, frozen and detached from state: the
MODEL's own calls, each closed by a `stream.tool_end` bracket. Calls a tool
makes from inside itself (`ctx.tools`, an agent used as a tool) are that
tool's work and are not listed. A paused run's calls cross to the resumed
leg inside its checkpoint, which the host must keep server-side (as
`streamHandler` does): a forged checkpoint could list calls that never ran.

## Properties

### calls

> `readonly` **calls**: readonly [`AnswerToolCall`](/docs/api/interfaces/AnswerToolCall)[]

Defined in: [src/answer-validation/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L68)

***

### complete

> `readonly` **complete**: `boolean`

Defined in: [src/answer-validation/types.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L76)

`false` when the run may have made calls this list leaves out: more than
`limits.maxToolCalls`, an oversized name or id, a `resumeOnError` leg
whose failed attempt's calls this run never observed, or a resumed
checkpoint written before the run kept a ledger. A rule that needs
the whole list should report `unreachable` then, not pass.
