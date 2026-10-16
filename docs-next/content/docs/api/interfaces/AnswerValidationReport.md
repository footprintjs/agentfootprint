---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L140)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L152)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L145)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L149)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L146)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L143)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L148)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L150)

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L154)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L156)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L144)

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L147)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L141)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L142)
