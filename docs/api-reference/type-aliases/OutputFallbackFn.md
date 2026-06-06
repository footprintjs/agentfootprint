[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputFallbackFn

# Type Alias: OutputFallbackFn\<T\>

> **OutputFallbackFn**\<`T`\> = (`error`, `rawOutput`) => `Promise`\<`T`\> \| `T`

Defined in: [src/core/outputFallback.ts:87](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/outputFallback.ts#L87)

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
