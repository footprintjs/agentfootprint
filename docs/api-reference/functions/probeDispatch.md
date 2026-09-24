[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / probeDispatch

# Function: probeDispatch()

> **probeDispatch**(`runbookName`): [`ToolDispatch`](/agentfootprint/api/generated/interfaces/ToolDispatch.md)

Defined in: [src/core/runbook/dispatch.ts:128](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/dispatch.ts#L128)

The definition-time probe dispatch — handed to the procedure factory ONCE
at `runbookAsTool(...)` so the bridge can read the chart's declared
contract. Stage bodies do not run at build; a factory that calls tools at
build time hears exactly why that cannot work.

## Parameters

### runbookName

`string`

## Returns

[`ToolDispatch`](/agentfootprint/api/generated/interfaces/ToolDispatch.md)
