---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L209)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L221)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L214)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L218)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L215)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L212)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L217)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L219)

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L223)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L225)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L213)

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L216)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L210)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L211)
