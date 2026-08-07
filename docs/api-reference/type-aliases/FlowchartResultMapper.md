[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartResultMapper

# Type Alias: FlowchartResultMapper

> **FlowchartResultMapper** = (`snapshot`) => `string`

Defined in: [src/core/flowchartAsTool.ts:169](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/flowchartAsTool.ts#L169)

Optional result mapper. Receives the flowchart's final snapshot
(pruned to `FlowchartToolSnapshot`) and returns the string the LLM
sees as the tool result.

If omitted, the default behavior is `JSON.stringify(snapshot.values)`.

Errors thrown from the mapper become the tool result with a
`[mapper-error: ...]` prefix so the LLM sees a useful diagnostic.

## Parameters

### snapshot

[`FlowchartToolSnapshot`](/agentfootprint/api/generated/interfaces/FlowchartToolSnapshot.md)

## Returns

`string`
