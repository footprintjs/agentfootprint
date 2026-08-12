[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / warnIfInvalidToolName

# Function: warnIfInvalidToolName()

> **warnIfInvalidToolName**(`name`): `void`

Defined in: [src/core/tools.ts:253](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/tools.ts#L253)

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
