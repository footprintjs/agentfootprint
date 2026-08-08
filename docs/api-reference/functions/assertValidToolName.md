[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertValidToolName

# Function: assertValidToolName()

> **assertValidToolName**(`name`): `asserts name is string`

Defined in: [src/core/tools.ts:155](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/tools.ts#L155)

STRICT validation — throws a clear, actionable error if a tool name can't be
sent to an LLM. Exposed for consumers who want to fail hard (e.g. in a build
step or a test). The library itself only WARNS (see `warnIfInvalidToolName`),
because a name is provider-specific: a mock or a name-sanitizing custom provider
may accept dotted/namespaced names that OpenAI/Anthropic reject.

## Parameters

### name

`unknown`

## Returns

`asserts name is string`
