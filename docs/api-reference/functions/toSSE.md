[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toSSE

# Function: toSSE()

> **toSSE**\<`TIn`, `TOut`\>(`runner`, `options?`): `AsyncIterable`\<`string`\>

Defined in: [agentfootprint/src/stream.ts:68](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L68)

Subscribe to a runner's `EventDispatcher` and yield SSE-formatted
strings until the run completes.

## Type Parameters

### TIn

`TIn`

### TOut

`TOut`

## Parameters

### runner

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<`TIn`, `TOut`\>

### options?

[`ToSSEOptions`](/agentfootprint/api/generated/interfaces/ToSSEOptions.md) = `{}`

## Returns

`AsyncIterable`\<`string`\>
