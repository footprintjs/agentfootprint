---
title: assertValidToolName
---

# Function: assertValidToolName()

> **assertValidToolName**(`name`): `asserts name is string`

Defined in: [src/lib/toolName.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/toolName.ts#L28)

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
