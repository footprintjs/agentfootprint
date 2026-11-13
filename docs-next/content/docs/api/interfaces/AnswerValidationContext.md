---
title: AnswerValidationContext
---

# Interface: AnswerValidationContext

Defined in: [src/answer-validation/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L100)

Capabilities for this invocation only; retained readers close on completion.

## Properties

### artifacts

> `readonly` **artifacts**: [`AnswerEvidenceResolver`](/docs/api/interfaces/AnswerEvidenceResolver)

Defined in: [src/answer-validation/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L102)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/answer-validation/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L101)

***

### toolCalls

> `readonly` **toolCalls**: [`AnswerToolCallsView`](/docs/api/interfaces/AnswerToolCallsView)

Defined in: [src/answer-validation/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L104)

This run's tool calls, never another run's. Empty when no tool ran.
