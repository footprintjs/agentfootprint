[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertResultClass

# Function: assertResultClass()

> **assertResultClass**(`toolName`, `resultClass`): `void`

Defined in: [src/core/tools.ts:440](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/tools.ts#L440)

Refuse a `resultClass` outside the closed set, at definition time — naming
the tool, the value and the whole vocabulary (the `assertResultCeiling`
law: a declaration this library cannot honor fails HERE, never at the
first gate run of the first CI pipeline). Exported beside it for consumers
assembling `Tool` objects by hand.

## Parameters

### toolName

`string`

### resultClass

[`ToolResultClass`](/agentfootprint/api/generated/type-aliases/ToolResultClass.md) \| `undefined`

## Returns

`void`
