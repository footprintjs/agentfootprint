---
title: assertComposedOf
---

# Function: assertComposedOf()

> **assertComposedOf**(`toolName`, `composedOf`): `void`

Defined in: [src/core/tools.ts:585](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L585)

Refuse a `composedOf` list that could never be drift-checked, at definition
time — the assertArgumentsFrom law applied to composition: the
agent-build gate joins on these names, and a blank one — or a tool composed
of itself — would join the wrong subjects or none. The REGISTRATION check
(is every named ingredient actually registered?) deliberately does NOT
happen here: the ingredients need not exist before this tool is defined,
and only the agent build sees the complete catalog.

## Parameters

### toolName

`string`

### composedOf

readonly `string`[] \| `undefined`

## Returns

`void`
