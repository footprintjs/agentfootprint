---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L221)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:241](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L241)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:233](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L233)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L237)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L234)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L224)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L236)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L239)

Why the report is `unverified`, or that a `failed` one also has unreachable rows.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L243)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L245)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L232)

`passed`: at least one comparison ran, and none failed or was unreachable.
`failed`: a comparison found the answer wrong — even beside `unreachable`
rows, which `reason` then still names (`unreachable-checks`).
`unverified`: no verdict could be reached (nothing compared, a check that
could not run or did not finish); `reason` says why.

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L235)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L222)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L223)
