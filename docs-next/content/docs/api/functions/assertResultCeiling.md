---
title: assertResultCeiling
---

# Function: assertResultCeiling()

> **assertResultCeiling**(`toolName`, `ceiling`): `void`

Defined in: [src/core/tools.ts:310](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L310)

Refuse a `resultCeiling` this library cannot honor, at definition time —
naming the tool and the fix, never failing at the first oversized result of
the first run. Exported beside [assertValidToolName](/docs/api/functions/assertValidToolName) for consumers
assembling `Tool` objects by hand.

## Parameters

### toolName

`string`

### ceiling

[`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling) \| `undefined`

## Returns

`void`
