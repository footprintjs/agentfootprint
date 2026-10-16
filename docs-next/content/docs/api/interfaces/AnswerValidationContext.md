---
title: AnswerValidationContext
---

# Interface: AnswerValidationContext

Defined in: [src/answer-validation/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L80)

Capabilities for this invocation only; retained readers close on completion.

## Properties

### artifacts

> `readonly` **artifacts**: [`AnswerEvidenceResolver`](/docs/api/interfaces/AnswerEvidenceResolver)

Defined in: [src/answer-validation/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L82)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/answer-validation/types.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L81)

***

### toolCalls

> `readonly` **toolCalls**: [`AnswerToolCallsView`](/docs/api/interfaces/AnswerToolCallsView)

Defined in: [src/answer-validation/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L84)

This run's tool calls, never another run's. Empty when no tool ran.
