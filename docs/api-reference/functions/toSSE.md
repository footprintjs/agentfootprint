[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toSSE

# Function: toSSE()

> **toSSE**\<`TIn`, `TOut`\>(`runner`, `options?`): `AsyncIterable`\<`string`\>

Defined in: [src/stream.ts:68](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/stream.ts#L68)

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
