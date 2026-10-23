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

Defined in: [src/answer-validation/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L213)

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
  trimmed, white space collapsed, under a full case fold without the
  Turkic mappings; case agrees only for a word of more than three letters
  whose first letter or whole word is cased differently (`'Settled'` and
  `'settled '`, `'STRASSE'` and `'Straße'` agree); a number and a plain
  decimal string by value (`42.5` and `'42.50'`); a number with a unit
  only with the same unit, written exactly (`MW` is not `mW`). Values that
  cannot be compared safely are `unreachable`, never `checked-fail`: a
  list or an object against a scalar, a unit against a bare number, any
  other case difference (a short word or unit such as `'MW'`/`'mW'`, a
  mixed-case word, text with a digit, `'Masse'`/`'Maße'`, `'ılık'`/
  `'ilik'`), and a value written with a currency symbol, digit
  separators, a dot-grouped number (`'1.250'`), a date or a time unless
  written the same.
  The row can only WITHHOLD: it reads every reading of the fact this run
  made (from any tool, with no scope or age check, so any reading may be
  forged or stale), and one more reading never makes it more permissive.
  Contradicts any value this run read for the fact: `checked-fail`,
  whatever else was read (a found contradiction is never relabelled
  unverified). Agrees with them:
  `not-applicable` — agreement is not verification. No tool result
  settled the fact (a follow-up turn answering from an earlier run's read
  included): `not-applicable`, not checked. `unreachable`, so enforce
  withholds and observe delivers "not sure": readings that disagree; a
  reading that settled the fact only as unknown, `null` or `'unknown'` (in
  any case) beside a stated value the answer does not contradict; doubt
  on both sides; or a value or reading that is not a well-formed `Claim`. Leaves the field out, or
  declines it (`null`, `'unknown'`) where the run read values:
  `not-applicable`.
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

Defined in: [src/answer-validation/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L214)

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

[`AnswerValidationContext`](/docs/api/interfaces/AnswerValidationContext)

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
