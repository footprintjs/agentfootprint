---
title: AnswerValidationOptions<T>
---

# Interface: AnswerValidationOptions\<T\>

Defined in: src/answer-validation/types.ts:66

Opt-in contract. The callback cannot replace the accepted answer.

## Type Parameters

### T

`T` = `unknown`

## Properties

### id

> `readonly` **id**: `string`

Defined in: src/answer-validation/types.ts:67

***

### limits?

> `readonly` `optional` **limits?**: `AnswerValidationLimits`

Defined in: src/answer-validation/types.ts:71

***

### mode?

> `readonly` `optional` **mode?**: `"enforce"` \| `"observe"`

Defined in: src/answer-validation/types.ts:70

Enforce withholds non-passing results; observe records them. Default enforce.

***

### version

> `readonly` **version**: `string`

Defined in: src/answer-validation/types.ts:68

## Methods

### validate()

> **validate**(`candidate`, `context`): `AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>

Defined in: src/answer-validation/types.ts:72

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

`AnswerValidationContext`

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
