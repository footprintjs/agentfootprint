---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: src/answer-validation/types.ts:91

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: src/answer-validation/types.ts:103

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: src/answer-validation/types.ts:96

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: src/answer-validation/types.ts:100

***

### failed

> `readonly` **failed**: `number`

Defined in: src/answer-validation/types.ts:97

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: src/answer-validation/types.ts:94

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: src/answer-validation/types.ts:99

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: src/answer-validation/types.ts:101

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: src/answer-validation/types.ts:105

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: src/answer-validation/types.ts:107

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"passed"` \| `"failed"` \| `"unverified"`

Defined in: src/answer-validation/types.ts:95

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: src/answer-validation/types.ts:98

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: src/answer-validation/types.ts:92

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: src/answer-validation/types.ts:93
