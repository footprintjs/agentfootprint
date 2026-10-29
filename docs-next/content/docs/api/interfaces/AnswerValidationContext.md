---
title: AnswerValidationContext
---

# Interface: AnswerValidationContext

Defined in: [src/answer-validation/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L97)

Capabilities for this invocation only; retained readers close on completion.

## Properties

### artifacts

> `readonly` **artifacts**: [`AnswerEvidenceResolver`](/docs/api/interfaces/AnswerEvidenceResolver)

Defined in: [src/answer-validation/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L99)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/answer-validation/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L98)

***

### toolCalls

> `readonly` **toolCalls**: [`AnswerToolCallsView`](/docs/api/interfaces/AnswerToolCallsView)

Defined in: [src/answer-validation/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L101)

This run's tool calls, never another run's. Empty when no tool ran.
