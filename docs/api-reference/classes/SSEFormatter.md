[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SSEFormatter

# Class: SSEFormatter\<TIn, TOut\>

Defined in: [src/stream.ts:153](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/stream.ts#L153)

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

Defined in: [src/stream.ts:154](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/stream.ts#L154)

#### Parameters

##### runner

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<`TIn`, `TOut`\>

##### options?

[`ToSSEOptions`](/agentfootprint/api/generated/interfaces/ToSSEOptions.md) = `{}`

#### Returns

`SSEFormatter`\<`TIn`, `TOut`\>

## Methods

### stream()

> **stream**(): `AsyncIterable`\<`string`\>

Defined in: [src/stream.ts:160](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/stream.ts#L160)

Async iterable of SSE chunks. Consume with `for await`.

#### Returns

`AsyncIterable`\<`string`\>
