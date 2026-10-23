---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L226)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:248](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L248)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L240)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L244)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:241](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L241)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L229)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L243)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L246)

Why the report is `unverified`, or what a `failed` one could not reach as well.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L250)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L252)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L239)

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

Defined in: [src/answer-validation/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L242)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L227)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L228)
