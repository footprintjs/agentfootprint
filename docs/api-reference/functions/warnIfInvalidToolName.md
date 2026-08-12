[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / warnIfInvalidToolName

# Function: warnIfInvalidToolName()

> **warnIfInvalidToolName**(`name`): `void`

Defined in: [src/core/tools.ts:256](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L256)

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
