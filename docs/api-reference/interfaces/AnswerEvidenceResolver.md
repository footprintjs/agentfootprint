[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AnswerEvidenceResolver

# Interface: AnswerEvidenceResolver

Defined in: [src/answer-validation/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L35)

Read-only, bounded, and pre-bound to the run's artifact scope.

## Methods

### resolve()

> **resolve**(`ref`, `options`): `Promise`\<`AnswerEvidenceResolution`\>

Defined in: [src/answer-validation/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L37)

Exact kind match, as with tool wants. No listing or automatic parent walk.

#### Parameters

##### ref

`string`

##### options

###### kind

`string`

#### Returns

`Promise`\<`AnswerEvidenceResolution`\>
