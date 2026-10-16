---
title: AnswerValidationContext
---

# Interface: AnswerValidationContext

Defined in: [src/answer-validation/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L85)

Capabilities for this invocation only; retained readers close on completion.

## Properties

### artifacts

> `readonly` **artifacts**: [`AnswerEvidenceResolver`](/docs/api/interfaces/AnswerEvidenceResolver)

Defined in: [src/answer-validation/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L87)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/answer-validation/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L86)

***

### toolCalls

> `readonly` **toolCalls**: [`AnswerToolCallsView`](/docs/api/interfaces/AnswerToolCallsView)

Defined in: [src/answer-validation/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L89)

This run's tool calls, never another run's. Empty when no tool ran.
