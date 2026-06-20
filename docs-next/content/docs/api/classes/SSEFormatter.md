---
title: SSEFormatter<TIn, TOut>
---

# Class: SSEFormatter\<TIn, TOut\>

Defined in: [src/stream.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/stream.ts#L153)

Class form for consumers who prefer `new SSEFormatter(runner).stream()`.
Identical behavior to `toSSE(runner)` — pick by preference.

## Type Parameters

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Constructors

### Constructor

> **new SSEFormatter**\<`TIn`, `TOut`\>(`runner`, `options?`): `SSEFormatter`\<`TIn`, `TOut`\>

Defined in: [src/stream.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/stream.ts#L154)

#### Parameters

##### runner

[`RunnerBase`](/docs/api/classes/RunnerBase)\<`TIn`, `TOut`\>

##### options?

[`ToSSEOptions`](/docs/api/interfaces/ToSSEOptions) = `{}`

#### Returns

`SSEFormatter`\<`TIn`, `TOut`\>

## Methods

### stream()

> **stream**(): `AsyncIterable`\<`string`\>

Defined in: [src/stream.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/stream.ts#L160)

Async iterable of SSE chunks. Consume with `for await`.

#### Returns

`AsyncIterable`\<`string`\>
