---
title: toSSE
---

# Function: toSSE()

> **toSSE**\<`TIn`, `TOut`\>(`runner`, `options?`): `AsyncIterable`\<`string`\>

Defined in: [src/stream.ts:68](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/stream.ts#L68)

Subscribe to a runner's `EventDispatcher` and yield SSE-formatted
strings until the run completes.

## Type Parameters

### TIn

`TIn`

### TOut

`TOut`

## Parameters

### runner

[`RunnerBase`](/docs/api/classes/RunnerBase)\<`TIn`, `TOut`\>

### options?

[`ToSSEOptions`](/docs/api/interfaces/ToSSEOptions) = `{}`

## Returns

`AsyncIterable`\<`string`\>
