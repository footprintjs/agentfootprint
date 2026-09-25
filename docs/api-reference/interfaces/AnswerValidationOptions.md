[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AnswerValidationOptions

# Interface: AnswerValidationOptions\<T\>

Defined in: [src/answer-validation/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L66)

Opt-in contract. The callback cannot replace the accepted answer.

## Type Parameters

### T

`T` = `unknown`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/answer-validation/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L67)

***

### limits?

> `readonly` `optional` **limits?**: `AnswerValidationLimits`

Defined in: [src/answer-validation/types.ts:71](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L71)

***

### mode?

> `readonly` `optional` **mode?**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:70](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L70)

Enforce withholds non-passing results; observe records them. Default enforce.

***

### version

> `readonly` **version**: `string`

Defined in: [src/answer-validation/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L68)

## Methods

### validate()

> **validate**(`candidate`, `context`): `AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>

Defined in: [src/answer-validation/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/answer-validation/types.ts#L72)

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

`AnswerValidationContext`

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
