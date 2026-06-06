[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toSSE

# Function: toSSE()

> **toSSE**\<`TIn`, `TOut`\>(`runner`, `options?`): `AsyncIterable`\<`string`\>

Defined in: [src/stream.ts:68](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/stream.ts#L68)

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
