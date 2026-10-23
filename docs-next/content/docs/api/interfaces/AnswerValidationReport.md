---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L235)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L257)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L249)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L253)

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L250)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L238)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L252)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:255](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L255)

Why the report is `unverified`, or what a `failed` one could not reach as well.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L259)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L261)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:248](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L248)

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

Defined in: [src/answer-validation/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L251)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L236)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L237)
