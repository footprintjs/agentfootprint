---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L243)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L265)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L257)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L261)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L258)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L246)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L260)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L263)

Why the report is `unverified`, or what a `failed` one could not reach as well.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L267)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L269)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L256)

`passed`: at least one comparison ran, and none failed or was unreachable.
`failed`: a comparison found the answer wrong — even beside `unreachable`
rows, which `reason` then still names (`unreachable-checks`). An agent row
(`agentChecks`) that found a contradiction makes the report `failed` even
when your validator did not finish; `reason` says so (`validator-error`).
`unverified`: no verdict could be reached (nothing compared, a check that
could not run or did not finish); `reason` says why.

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L259)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L244)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L245)
