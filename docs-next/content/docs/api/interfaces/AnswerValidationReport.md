---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L134)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L146)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L139)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L143)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L140)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L137)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L142)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L144)

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L148)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L150)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L138)

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L141)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L135)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L136)
