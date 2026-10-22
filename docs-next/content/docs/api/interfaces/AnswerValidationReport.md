---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L214)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L234)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L226)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L230)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L227)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L217)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L229)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L232)

Why the report is `unverified`, or that a `failed` one also has unreachable rows.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L236)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L238)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L225)

`passed`: at least one comparison ran, and none failed or was unreachable.
`failed`: a comparison found the answer wrong — even beside `unreachable`
rows, which `reason` then still names (`unreachable-checks`).
`unverified`: no verdict could be reached (nothing compared, a check that
could not run or did not finish); `reason` says why.

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L228)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L215)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L216)
