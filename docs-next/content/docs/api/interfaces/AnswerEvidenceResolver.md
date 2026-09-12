---
title: AnswerEvidenceResolver
---

# Interface: AnswerEvidenceResolver

Defined in: [src/answer-validation/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L35)

Read-only, bounded, and pre-bound to the run's artifact scope.

## Methods

### resolve()

> **resolve**(`ref`, `options`): `Promise`\<`AnswerEvidenceResolution`\>

Defined in: [src/answer-validation/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L37)

Exact kind match, as with tool wants. No listing or automatic parent walk.

#### Parameters

##### ref

`string`

##### options

###### kind

`string`

#### Returns

`Promise`\<`AnswerEvidenceResolution`\>
