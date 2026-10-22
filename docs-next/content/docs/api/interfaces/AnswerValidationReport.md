---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L209)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L229)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L221)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L225)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L222)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L212)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L224)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L227)

Why the report is `unverified`, or that a `failed` one also has unreachable rows.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:231](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L231)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:233](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L233)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L220)

`passed`: at least one comparison ran, and none failed or was unreachable.
`failed`: a comparison found the answer wrong — even beside `unreachable`
rows, which `reason` then still names (`unreachable-checks`).
`unverified`: no verdict could be reached (nothing compared, a check that
could not run or did not finish); `reason` says why.

***

### unreachable

> `readonly` **unreachable**: `number`

Defined in: [src/answer-validation/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L223)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L210)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L211)
