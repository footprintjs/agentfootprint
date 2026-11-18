---
title: AnswerValidationReport
---

# Interface: AnswerValidationReport

Defined in: [src/answer-validation/types.ts:269](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L269)

Cloneable decision record. It contains no candidate or artifact payload.

## Properties

### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `string`

Defined in: [src/answer-validation/types.ts:291](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L291)

SHA-256 of the exact canonical JSON content considered for delivery.

***

### checked

> `readonly` **checked**: `number`

Defined in: [src/answer-validation/types.ts:283](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L283)

***

### checks

> `readonly` **checks**: readonly [`AnswerCheck`](/docs/api/interfaces/AnswerCheck)[]

Defined in: [src/answer-validation/types.ts:287](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L287)

***

### delivery?

> `readonly` `optional` **delivery?**: `"as-checked"` \| `"recorded"` \| `"fallback"`

Defined in: [src/answer-validation/types.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L297)

Runtime delivery authorization for a composed negative; never a verification verdict.

***

### failed

> `readonly` **failed**: `number`

Defined in: [src/answer-validation/types.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L284)

***

### mode

> `readonly` **mode**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L272)

***

### notApplicable

> `readonly` **notApplicable**: `number`

Defined in: [src/answer-validation/types.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L286)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [src/answer-validation/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L289)

Why the report is `unverified`, or what a `failed` one could not reach as well.

***

### resolvedRefs

> `readonly` **resolvedRefs**: readonly `string`[]

Defined in: [src/answer-validation/types.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L293)

Successfully resolved refs, distinct, not a count of semantic comparisons.

***

### schemaAccepted

> `readonly` **schemaAccepted**: `boolean`

Defined in: [src/answer-validation/types.ts:295](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L295)

The schema parser accepted and its output is a lossless canonical JSON value.

***

### status

> `readonly` **status**: `"failed"` \| `"unverified"` \| `"passed"`

Defined in: [src/answer-validation/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L282)

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

Defined in: [src/answer-validation/types.ts:285](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L285)

***

### validatorId

> `readonly` **validatorId**: `string`

Defined in: [src/answer-validation/types.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L270)

***

### validatorVersion

> `readonly` **validatorVersion**: `string`

Defined in: [src/answer-validation/types.ts:271](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L271)
