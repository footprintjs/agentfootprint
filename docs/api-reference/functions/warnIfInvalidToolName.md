[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / warnIfInvalidToolName

# Function: warnIfInvalidToolName()

> **warnIfInvalidToolName**(`name`): `void`

Defined in: [src/core/tools.ts:164](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/core/tools.ts#L164)

DEV-MODE heads-up (never throws): warns once-per-call if a tool name will be
rejected by OpenAI/Anthropic. Production and non-dev runs pay nothing. This is
the library's default guard (Convention: dev diagnostics warn, they don't throw)
— keeping mock/custom-provider + namespaced-name setups working. Reach for
`assertValidToolName` when you want a hard failure.

## Parameters

### name

`unknown`

## Returns

`void`
