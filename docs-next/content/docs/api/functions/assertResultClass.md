---
title: assertResultClass
---

# Function: assertResultClass()

> **assertResultClass**(`toolName`, `resultClass`): `void`

Defined in: [src/core/tools.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L229)

Refuse a `resultClass` outside the closed set, at definition time — naming
the tool, the value and the whole vocabulary (the `assertResultCeiling`
law: a declaration this library cannot honor fails HERE, never at the
first gate run of the first CI pipeline). Exported beside it for consumers
assembling `Tool` objects by hand.

## Parameters

### toolName

`string`

### resultClass

[`ToolResultClass`](/docs/api/type-aliases/ToolResultClass) \| `undefined`

## Returns

`void`
