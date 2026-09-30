---
title: JudgmentRow
---

# Interface: JudgmentRow

Defined in: [src/core/agent/findings/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L246)

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

> `readonly` **against**: `"question"` \| `"proposition"`

Defined in: [src/core/agent/findings/types.ts:255](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L255)

What the result was judged AGAINST: the call's declared proposition, or the user's question.

***

### clipped?

> `readonly` `optional` **clipped?**: `true`

Defined in: [src/core/agent/findings/types.ts:264](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L264)

Set when the result text was cut at `JUDGE_RESULT_CHARS` before the judge saw it.

***

### confidence

> `readonly` **confidence**: `number`

Defined in: [src/core/agent/findings/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L258)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:266](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L266)

The iteration whose dispatch landed the result.

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L253)

The classifier's port name and the provider's resolved model string.

#### model

> `readonly` **model**: `string`

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment"`

Defined in: [src/core/agent/findings/types.ts:247](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L247)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:262](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L262)

***

### probabilities

> `readonly` **probabilities**: `Readonly`\<`Record`\<[`Standing`](/docs/api/type-aliases/Standing), `number`\>\>

Defined in: [src/core/agent/findings/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L257)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L251)

***

### standing

> `readonly` **standing**: [`Standing`](/docs/api/type-aliases/Standing)

Defined in: [src/core/agent/findings/types.ts:256](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L256)

***

### testsSubject?

> `readonly` `optional` **testsSubject?**: `number`

Defined in: [src/core/agent/findings/types.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L260)

The provider's probability that the result tests the proposition / question at all.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L249)

The RESULT judged — the tool call's id, the same key `StandingRow` uses.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L250)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L273)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### usage?

> `readonly` `optional` **usage?**: `object`

Defined in: [src/core/agent/findings/types.ts:261](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L261)

#### inputTokens

> `readonly` **inputTokens**: `number`

#### outputTokens

> `readonly` **outputTokens**: `number`
