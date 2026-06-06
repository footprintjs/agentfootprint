[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolExecutionContext

# Interface: ToolExecutionContext

Defined in: [src/core/tools.ts:26](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L26)

Runtime context passed to tool.execute().

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/tools.ts:30](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L30)

Current iteration number of the ReAct loop.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/tools.ts:32](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L32)

Abort signal propagated from run({ env: { signal } }).

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/tools.ts:28](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L28)

Unique id of THIS tool invocation (matches stream.tool_start.toolCallId).
