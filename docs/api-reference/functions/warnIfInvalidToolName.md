[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / warnIfInvalidToolName

# Function: warnIfInvalidToolName()

> **warnIfInvalidToolName**(`name`): `void`

Defined in: [src/core/tools.ts:1010](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/tools.ts#L1010)

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
