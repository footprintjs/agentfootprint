---
title: JudgmentRow
---

# Interface: JudgmentRow

Defined in: [src/core/agent/findings/types.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L212)

A SECOND SOURCE's reading of one result (9.104.0, `.findings({ judge })`):
a calibrated classifier (`agentfootprint/classify`) asked what the result
is worth for the proposition the model declared before the call — or, when
the call declared none, for the user's question (`against` says which).
Written beside the model's own `StandingRow`, never merged with it and
never served in its place: `foldLedger(...).standingOf` stays the model's
reading, `foldLedger(...).judgments` is the judge's. A disagreement between
the two is a FACT of the record, resolved by nobody.

Every field is the provider's own data or a measurement around the call —
`probabilities` as sent (never renormalised), `confidence` as sent,
`testsSubject` the provider's probability that the result tests the
proposition at all, `usage` when the provider reported it, `latencyMs`
measured by the adapter. Nothing here is inferred by the library.

## Properties

### against

> `readonly` **against**: `"proposition"` \| `"question"`

Defined in: [src/core/agent/findings/types.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L221)

What the result was judged AGAINST: the call's declared proposition, or the user's question.

***

### clipped?

> `readonly` `optional` **clipped?**: `true`

Defined in: [src/core/agent/findings/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L230)

Set when the result text was cut at `JUDGE_RESULT_CHARS` before the judge saw it.

***

### confidence

> `readonly` **confidence**: `number`

Defined in: [src/core/agent/findings/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L224)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L232)

The iteration whose dispatch landed the result.

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L219)

The classifier's port name and the provider's resolved model string.

#### model

> `readonly` **model**: `string`

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment"`

Defined in: [src/core/agent/findings/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L213)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L228)

***

### probabilities

> `readonly` **probabilities**: `Readonly`\<`Record`\<[`Standing`](/docs/api/type-aliases/Standing), `number`\>\>

Defined in: [src/core/agent/findings/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L223)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L217)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L222)

***

### testsSubject?

> `readonly` `optional` **testsSubject?**: `number`

Defined in: [src/core/agent/findings/types.ts:226](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L226)

The provider's probability that the result tests the proposition / question at all.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L215)

The RESULT judged — the tool call's id, the same key `StandingRow` uses.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L216)

***

### usage?

> `readonly` `optional` **usage?**: `object`

Defined in: [src/core/agent/findings/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L227)

#### inputTokens

> `readonly` **inputTokens**: `number`

#### outputTokens

> `readonly` **outputTokens**: `number`
