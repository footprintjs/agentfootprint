---
title: AnswerValidationOptions<T>
---

# Interface: AnswerValidationOptions\<T\>

Defined in: [src/answer-validation/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L114)

Opt-in contract. The callback cannot replace the accepted answer.

## Type Parameters

### T

`T` = `unknown`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/answer-validation/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L115)

***

### limits?

> `readonly` `optional` **limits?**: `AnswerValidationLimits`

Defined in: [src/answer-validation/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L119)

***

### mode?

> `readonly` `optional` **mode?**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L118)

Enforce withholds non-passing results; observe records them. Default enforce.

***

### version

> `readonly` **version**: `string`

Defined in: [src/answer-validation/types.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L116)

## Methods

### validate()

> **validate**(`candidate`, `context`): `AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>

Defined in: [src/answer-validation/types.ts:120](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L120)

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

[`AnswerValidationContext`](/docs/api/interfaces/AnswerValidationContext)

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
