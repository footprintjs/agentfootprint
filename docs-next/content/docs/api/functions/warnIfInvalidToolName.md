---
title: warnIfInvalidToolName
---

# Function: warnIfInvalidToolName()

> **warnIfInvalidToolName**(`name`): `void`

Defined in: [src/core/tools.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L145)

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
