[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputSchemaOptions

# Interface: OutputSchemaOptions

Defined in: [src/core/outputSchema.ts:93](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/outputSchema.ts#L93)

Optional configuration for `outputSchema`.

## Properties

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/core/outputSchema.ts:108](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/outputSchema.ts#L108)

Custom system-prompt instruction text. Defaults to a generic
"Respond with valid JSON matching the output schema. Do not
include prose." sentence (extended with `parser.description`
when present). Override when the LLM benefits from a
domain-specific framing.

***

### jsonSchema?

> `readonly` `optional` **jsonSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/outputSchema.ts:144](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/outputSchema.ts#L144)

The JSON Schema for the synthetic tool, required by
`strategy: 'tool-forced'` unless the parser can produce one itself
(a `toJsonSchema()` method, which ArkType has). The library will not
infer a shape from a `parse()` function — guessing what your schema
means is not a thing it gets to do.

This value and the parser CAN disagree. Nothing here prevents that,
and nothing needs to: the forced shape satisfies the wire, the parser
still judges the answer, and a disagreement surfaces as an ordinary
validation failure that the retry loop corrects using the validator's
own words. The schema constrains generation; the parser remains the
judge.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/outputSchema.ts:100](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/outputSchema.ts#L100)

Injection id for the auto-generated "respond with this shape"
instruction. Defaults to `'output-schema'`. Override when you
have multiple agents with different schemas in one process and
want the diagnostic events to disambiguate.

***

### retries?

> `readonly` `optional` **retries?**: `number`

Defined in: [src/core/outputSchema.ts:124](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/outputSchema.ts#L124)

How many corrective re-asks the run may spend when the final answer
fails the schema. Default `0` — the historical behaviour, where the
first answer is the only answer and `runTyped()` throws on a bad one.

Each retry is a REAL turn: the failed answer and an authored corrective
message join the conversation, the ReAct loop re-enters, and the next
attempt gets its own `llm_start`/`llm_end` bracket and its own
`cost.tick` against `costBudget`. A retry therefore consumes one
iteration of the agent's budget, the same way a tool call does.

When the cap is spent the last answer stands and `runTyped()` throws
`OutputSchemaError` exactly as it always has — `.outputFallback()`
composes on top, unchanged.

***

### strategy?

> `readonly` `optional` **strategy?**: [`OutputSchemaStrategy`](/agentfootprint/api/generated/type-aliases/OutputSchemaStrategy.md)

Defined in: [src/core/outputSchema.ts:129](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/outputSchema.ts#L129)

How the schema reaches the model. Default `'instruct'`.
See [OutputSchemaStrategy](/agentfootprint/api/generated/type-aliases/OutputSchemaStrategy.md).
