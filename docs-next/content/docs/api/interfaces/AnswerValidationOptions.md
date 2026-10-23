---
title: AnswerValidationOptions<T>
---

# Interface: AnswerValidationOptions\<T\>

Defined in: [src/answer-validation/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L123)

Opt-in contract. The callback cannot replace the accepted answer.

## Type Parameters

### T

`T` = `unknown`

## Properties

### agentChecks?

> `readonly` `optional` **agentChecks?**: readonly [`AgentCheckName`](/docs/api/type-aliases/AgentCheckName)[]

Defined in: [src/answer-validation/types.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L204)

The agent's own answer checks that take part in this validation. Opt-in:
omitted, the report holds your checks alone, exactly as before.

Why: on their own, `.claims()` and `.namesAndNumbersFromEvidence()` only
record what they find — a typed field that contradicts the fact a tool
settled, or a value no tool result carried, is filed as a finding and the
answer is still delivered. Listed here, each finding becomes a failed row
of this report, so `mode: 'enforce'` withholds that answer the way it
withholds one your own check failed, with draft tokens held back the same
way. `mode: 'observe'` records the rows and delivers.

- `'claims'`: one row per declared `.claims()` field, id
  `agent:claims:<field>`, judged on the candidate this validation delivers.
  Values compare after one declared normalization: text in Unicode NFC,
  trimmed, white space collapsed, a word case-folded (`'Settled'` and
  `'settled '` agree); a number and a plain decimal string by value
  (`42.5` and `'42.50'` agree); a number with a unit only with the same
  unit, written exactly (`MW` is not `mW`). Values that cannot be
  compared safely — a list or an object against a scalar, a unit against
  a bare number, text with a digit that differs only in case, a value
  written with a currency symbol, thousands separators, a date or a time
  unless written the same — are `unreachable`, never `checked-fail`. Contradicts the fact a tool settled: `checked-fail`. Agrees with it:
  `not-applicable` — the contract is unscoped (the latest row for the
  fact from any tool, with no scope or age check), so agreement is not
  verification. States a value for a fact no tool result settled, one
  settled as unknown or only as `null` / `'unknown'`, or one this run's
  tool results settled two ways — or gives no value where the tool
  settled only `null` or `'unknown'` (agreement on doubt verifies
  nothing): `unreachable`, so enforce withholds and observe delivers "not
  sure". Leaves the field out, or declines it (`null`, `'unknown'`) where
  the run settled a value: `not-applicable`. Facts are this run's reads
  only: a follow-up turn that answers from an earlier run's read is
  `unreachable`.
- `'names-and-numbers'`: one row, id `agent:names-and-numbers`: the gate
  asked of the exact candidate this validation delivers, after any output
  transform (its one repair turn under `posture: 'guard'` runs earlier, on
  the model's draft). It judges the answer's values, never its field names
  (`p95LatencyMs` is not a value); short numbers below the gate's
  `minDigits` (default 4) are not looked up. A value no tool result carried: `checked-fail`.
  A value not found while the index was past its ceiling, or an answer
  longer than the gate reads (20,000 words and numbers; the reason says
  how many more were never looked up): `unreachable`.
  A clean pass is `not-applicable`: finding a value clears it, and never
  verifies the answer.

No agent row is ever `checked-pass`: these checks can withhold an answer
and never verify one. `validate` stays required, and only your checks can
make the report `passed` — a report with no comparison of yours stays
`unverified`. Each listed check needs its builder call, or `build()`
refuses. Rows carry counts and the field names you declared, never a value
from the answer or a tool, nor the entity a contract names. Check ids that
start with `agent:` are reserved while this is set.

#### Example

```ts
Agent.create({ provider, model })
  .tool(readBuild) // returns describedResult({ facts: [{ entity: 'build-72', durationMs: 1250 }], … })
  .outputSchema(BuildReport)
  .claims({ durationMs: { entity: 'build-72', field: 'durationMs' } })
  .namesAndNumbersFromEvidence({ posture: 'guard' })
  .answerValidation({
    id: 'build-report',
    version: '1',
    agentChecks: ['claims', 'names-and-numbers'],
    validate: (answer) => ({
      checks: [{ id: 'asked-job', disposition: answer.job === 'build-72' ? 'checked-pass' : 'checked-fail' }],
    }),
  })
  .build();
// An answer that keeps durationMs: 9750 through its one repair turn now
// throws AnswerValidationError instead of being returned: status 'failed',
// rows 'agent:names-and-numbers' and 'agent:claims:durationMs'.
```

***

### id

> `readonly` **id**: `string`

Defined in: [src/answer-validation/types.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L124)

***

### limits?

> `readonly` `optional` **limits?**: `AnswerValidationLimits`

Defined in: [src/answer-validation/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L128)

***

### mode?

> `readonly` `optional` **mode?**: `"enforce"` \| `"observe"`

Defined in: [src/answer-validation/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L127)

Enforce withholds non-passing results; observe records them. Default enforce.

***

### version

> `readonly` **version**: `string`

Defined in: [src/answer-validation/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L125)

## Methods

### validate()

> **validate**(`candidate`, `context`): `AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>

Defined in: [src/answer-validation/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L205)

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

[`AnswerValidationContext`](/docs/api/interfaces/AnswerValidationContext)

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
