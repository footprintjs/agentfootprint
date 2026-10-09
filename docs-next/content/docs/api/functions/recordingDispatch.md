---
title: recordingDispatch
---

# Function: recordingDispatch()

> **recordingDispatch**(`delivered`, `runbookName`): [`RecordedDispatch`](/docs/api/interfaces/RecordedDispatch)

Defined in: [src/core/runbook/dispatch.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/dispatch.ts#L84)

Wrap the delivered dispatch (or its absence) for one runbook invocation.

With NO dispatch delivered (`ctx.tools` absent — a hand-built context, a
door with no dispatch map) the wrapper is the fail-closed teacher: `has`
answers false and `call` refuses naming the fix, so a procedure that needs
inner tools fails loudly at its first call instead of half-running.

## Parameters

### delivered

[`ToolDispatch`](/docs/api/interfaces/ToolDispatch) \| `undefined`

### runbookName

`string`

## Returns

[`RecordedDispatch`](/docs/api/interfaces/RecordedDispatch)
