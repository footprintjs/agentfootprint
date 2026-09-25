[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / JudgmentRow

# Interface: JudgmentRow

Defined in: [src/core/agent/findings/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L213)

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

Defined in: [src/core/agent/findings/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L222)

What the result was judged AGAINST: the call's declared proposition, or the user's question.

***

### clipped?

> `readonly` `optional` **clipped?**: `true`

Defined in: [src/core/agent/findings/types.ts:231](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L231)

Set when the result text was cut at `JUDGE_RESULT_CHARS` before the judge saw it.

***

### confidence

> `readonly` **confidence**: `number`

Defined in: [src/core/agent/findings/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L225)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:233](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L233)

The iteration whose dispatch landed the result.

***

### judge

> `readonly` **judge**: `object`

Defined in: [src/core/agent/findings/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L220)

The classifier's port name and the provider's resolved model string.

#### model

> `readonly` **model**: `string`

#### name

> `readonly` **name**: `string`

***

### kind

> `readonly` **kind**: `"judgment"`

Defined in: [src/core/agent/findings/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L214)

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: [src/core/agent/findings/types.ts:229](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L229)

***

### probabilities

> `readonly` **probabilities**: `Readonly`\<`Record`\<[`Standing`](/agentfootprint/api/generated/type-aliases/Standing.md), `number`\>\>

Defined in: [src/core/agent/findings/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L224)

***

### source

> `readonly` **source**: `"judge"`

Defined in: [src/core/agent/findings/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L218)

***

### standing

> `readonly` **standing**: [`Standing`](/agentfootprint/api/generated/type-aliases/Standing.md)

Defined in: [src/core/agent/findings/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L223)

***

### testsSubject?

> `readonly` `optional` **testsSubject?**: `number`

Defined in: [src/core/agent/findings/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L227)

The provider's probability that the result tests the proposition / question at all.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L216)

The RESULT judged — the tool call's id, the same key `StandingRow` uses.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/findings/types.ts:217](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L217)

***

### usage?

> `readonly` `optional` **usage?**: `object`

Defined in: [src/core/agent/findings/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L228)

#### inputTokens

> `readonly` **inputTokens**: `number`

#### outputTokens

> `readonly` **outputTokens**: `number`
