---
title: AnswerEvidenceResolver
---

# Interface: AnswerEvidenceResolver

Defined in: [src/answer-validation/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L49)

Read-only, bounded, and pre-bound to the run's artifact scope.

## Methods

### resolve()

> **resolve**(`ref`, `options`): `Promise`\<`AnswerEvidenceResolution`\>

Defined in: [src/answer-validation/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L51)

Exact kind match, as with tool wants. No listing or automatic parent walk.

#### Parameters

##### ref

`string`

##### options

###### kind

`string`

#### Returns

`Promise`\<`AnswerEvidenceResolution`\>
