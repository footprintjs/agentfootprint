[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / assertResultCeiling

# Function: assertResultCeiling()

> **assertResultCeiling**(`toolName`, `ceiling`): `void`

Defined in: [src/core/tools.ts:399](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L399)

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
