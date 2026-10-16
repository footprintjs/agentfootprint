---
title: AnswerValidationContext
---

# Interface: AnswerValidationContext

Defined in: [src/answer-validation/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L86)

Capabilities for this invocation only; retained readers close on completion.

## Properties

### artifacts

> `readonly` **artifacts**: [`AnswerEvidenceResolver`](/docs/api/interfaces/AnswerEvidenceResolver)

Defined in: [src/answer-validation/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L88)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/answer-validation/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L87)

***

### toolCalls

> `readonly` **toolCalls**: [`AnswerToolCallsView`](/docs/api/interfaces/AnswerToolCallsView)

Defined in: [src/answer-validation/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L90)

This run's tool calls, never another run's. Empty when no tool ran.
