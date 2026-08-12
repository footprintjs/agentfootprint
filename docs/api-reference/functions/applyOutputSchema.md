[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / applyOutputSchema

# Function: applyOutputSchema()

> **applyOutputSchema**\<`T`\>(`raw`, `parser`): `T`

Defined in: [src/core/outputSchema.ts:197](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/outputSchema.ts#L197)

Parse + validate a raw string answer against a parser. Used by
`agent.parseOutput()` / `agent.runTyped()`. Centralized here so
both call sites share identical error-mapping behavior.

Two-stage error reporting:
  - JSON parse failure → `stage: 'json-parse'` (LLM emitted prose
    or malformed JSON)
  - Schema validation failure → `stage: 'schema-validate'` (JSON
    was valid but didn't match the contracted shape)

## Type Parameters

### T

`T`

## Parameters

### raw

`string`

### parser

[`OutputSchemaParser`](/agentfootprint/api/generated/interfaces/OutputSchemaParser.md)\<`T`\>

## Returns

`T`
