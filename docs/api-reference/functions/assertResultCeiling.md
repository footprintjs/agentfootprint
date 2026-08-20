[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertResultCeiling

# Function: assertResultCeiling()

> **assertResultCeiling**(`toolName`, `ceiling`): `void`

Defined in: [src/core/tools.ts:192](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L192)

Refuse a `resultCeiling` this library cannot honor, at definition time —
naming the tool and the fix, never failing at the first oversized result of
the first run. Exported beside [assertValidToolName](/agentfootprint/api/generated/functions/assertValidToolName.md) for consumers
assembling `Tool` objects by hand.

## Parameters

### toolName

`string`

### ceiling

[`ToolResultCeiling`](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md) \| `undefined`

## Returns

`void`
