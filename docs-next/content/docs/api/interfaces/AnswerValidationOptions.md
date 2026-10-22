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

Defined in: [src/answer-validation/types.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L182)

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
  Agrees with the fact a tool settled: `checked-pass`. Contradicts it:
  `checked-fail`. States a value for a fact no tool result settled, or one
  settled as unknown: `unreachable`. Leaves the field out, or declines it
  (`null`, `'unknown'`) where the run settled a value: `not-applicable`.
- `'names-and-numbers'`: one row, id `agent:names-and-numbers`, from the
  gate's verdict on the answer that stands, so after its one repair turn
  under `posture: 'guard'`. A value no tool result carried: `checked-fail`.
  A value not found while the index was past its ceiling: `unreachable`.
  A clean pass is `not-applicable`: finding a value clears it, and never
  verifies the answer.

Each listed check needs its builder call, or `build()` refuses. `validate`
still runs, and a report with no comparison stays `unverified`: the
evidence row never counts as one. Rows carry counts and the field names you
declared, never a value from the answer or a tool, nor the entity a
contract names. Check ids that start with `agent:` are reserved while this
is set.

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

Defined in: [src/answer-validation/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/answer-validation/types.ts#L183)

#### Parameters

##### candidate

`Readonly`\<`T`\>

##### context

[`AnswerValidationContext`](/docs/api/interfaces/AnswerValidationContext)

#### Returns

`AnswerValidationResult` \| `Promise`\<`AnswerValidationResult`\>
