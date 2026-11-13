---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:266](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L266)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L288)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L280)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L284)

***

### delivery?

> `readonly` `optional` **delivery?**: `"as-checked"` \| `"recorded"` \| `"fallback"`

Defined in: [src/answer-validation/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L294)

Runtime delivery authorization for a composed negative; never a verification verdict.

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L281)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L269)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:283](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L283)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L286)

Why the report is `unverified`, or what a `failed` one could not reach as well.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L290)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L292)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:279](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L279)

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

Defined in: [src/answer-validation/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L282)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L267)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L268)
