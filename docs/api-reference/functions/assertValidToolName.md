[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertValidToolName

# Function: assertValidToolName()

> **assertValidToolName**(`name`): `asserts name is string`

Defined in: [src/core/tools.ts:137](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/core/tools.ts#L137)

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
