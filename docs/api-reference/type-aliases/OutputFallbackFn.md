[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputFallbackFn

# Type Alias: OutputFallbackFn\<T\>

> **OutputFallbackFn**\<`T`\> = (`error`, `rawOutput`) => `Promise`\<`T`\> \| `T`

Defined in: [src/core/outputFallback.ts:87](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/outputFallback.ts#L87)

Tier-2 fallback function. Receives the original validation error +
the raw LLM output; returns a value that the agent will then try
to validate against the same schema.

If this function throws, OR its return value fails schema, the
agent falls through to the `canned` value (tier 3).

## Type Parameters

### T

`T`

## Parameters

### error

[`OutputSchemaError`](/agentfootprint/api/generated/classes/OutputSchemaError.md)

### rawOutput

`string`

## Returns

`Promise`\<`T`\> \| `T`
