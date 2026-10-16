---
title: AnswerValidationOptions<T>
---

# Interface: AnswerValidationOptions\<T\>

Defined in: [src/answer-validation/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L109)

Opt-in contract. The callback cannot replace the accepted answer.

## Type Parameters

### T

`T` = `unknown`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/answer-validation/types.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L110)

***

### limits?

> `readonly` `optional` **limits?**: `AnswerValidationLimits`

Defined in: [src/answer-validation/types.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L114)

***

### mode?

> `readonly` `optional` **mode?**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L113)

Enforce withholds non-passing results; observe records them. Default enforce.

***

### version

> `readonly` **version**: `string`

Defined in: [src/answer-validation/types.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L111)

## Methods

### validate()

> **validate**(`candidate`, `context`): `AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>

Defined in: [src/answer-validation/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L115)

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

[`AnswerValidationContext`](/docs/api/interfaces/AnswerValidationContext)

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
