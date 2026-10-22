---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L219)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L239)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:231](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L231)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L235)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L232)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L222)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:234](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L234)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L237)

Why the report is `unverified`, or that a `failed` one also has unreachable rows.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:241](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L241)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L243)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L230)

`passed`: at least one comparison ran, and none failed or was unreachable.
`failed`: a comparison found the answer wrong — even beside `unreachable`
rows, which `reason` then still names (`unreachable-checks`).
`unverified`: no verdict could be reached (nothing compared, a check that
could not run or did not finish); `reason` says why.

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:233](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L233)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L220)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L221)
