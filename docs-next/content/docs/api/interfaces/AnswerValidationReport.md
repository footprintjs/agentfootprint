---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L258)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L280)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L272)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:276](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L276)

***

### delivery?

> `readonly` `optional` **delivery?**: `"as-checked"` \| `"recorded"` \| `"fallback"`

Defined in: [src/answer-validation/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L286)

Runtime delivery authorization for a composed negative; never a verification verdict.

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L273)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L261)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L275)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L278)

Why the report is `unverified`, or what a `failed` one could not reach as well.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L282)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L284)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"unverified"` \| `"passed"` \| `"failed"`

Defined in: [src/answer-validation/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L271)

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

Defined in: [src/answer-validation/types.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L274)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L259)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L260)
