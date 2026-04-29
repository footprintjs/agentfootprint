[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolExecutionContext

# Interface: ToolExecutionContext

Defined in: [agentfootprint/src/core/tools.ts:26](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/tools.ts#L26)

Runtime context passed to tool.execute().

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [agentfootprint/src/core/tools.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/tools.ts#L30)

Current iteration number of the ReAct loop.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [agentfootprint/src/core/tools.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/tools.ts#L32)

Abort signal propagated from run({ env: { signal } }).

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [agentfootprint/src/core/tools.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/tools.ts#L28)

Unique id of THIS tool invocation (matches stream.tool_start.toolCallId).
