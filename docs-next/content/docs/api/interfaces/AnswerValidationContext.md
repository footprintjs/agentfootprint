---
title: AnswerValidationContext
---

# Interface: AnswerValidationContext

Defined in: [src/answer-validation/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L104)

Capabilities for this invocation only; retained readers close on completion.

## Properties

### artifacts

> `readonly` **artifacts**: [`AnswerEvidenceResolver`](/docs/api/interfaces/AnswerEvidenceResolver)

Defined in: [src/answer-validation/types.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L106)

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/answer-validation/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L105)

***

### toolCalls

> `readonly` **toolCalls**: [`AnswerToolCallsView`](/docs/api/interfaces/AnswerToolCallsView)

Defined in: [src/answer-validation/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L108)

This run's tool calls, never another run's. Empty when no tool ran.
