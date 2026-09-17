---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L91)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L103)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L96)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L100)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L97)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L94)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L99)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L101)

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L105)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L107)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"passed"` \| `"failed"` \| `"unverified"`

Defined in: [src/answer-validation/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L95)

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L98)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L92)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L93)
