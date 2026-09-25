[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / recordingDispatch

# Function: recordingDispatch()

> **recordingDispatch**(`delivered`, `runbookName`): [`RecordedDispatch`](/agentfootprint/api/generated/interfaces/RecordedDispatch.md)

Defined in: [src/core/runbook/dispatch.ts:84](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/dispatch.ts#L84)

Wrap the delivered dispatch (or its absence) for one runbook invocation.

With NO dispatch delivered (`ctx.tools` absent — a hand-built context, a
door with no dispatch map) the wrapper is the fail-closed teacher: `has`
answers false and `call` refuses naming the fix, so a procedure that needs
inner tools fails loudly at its first call instead of half-running.

## Parameters

### delivered

[`ToolDispatch`](/agentfootprint/api/generated/interfaces/ToolDispatch.md) \| `undefined`

### runbookName

`string`

## Returns

[`RecordedDispatch`](/agentfootprint/api/generated/interfaces/RecordedDispatch.md)
