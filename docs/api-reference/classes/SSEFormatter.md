[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SSEFormatter

# Class: SSEFormatter\<TIn, TOut\>

Defined in: [agentfootprint/src/stream.ts:151](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L151)

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

Defined in: [agentfootprint/src/stream.ts:152](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L152)

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

Defined in: [agentfootprint/src/stream.ts:158](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/stream.ts#L158)

Async iterable of SSE chunks. Consume with `for await`.

#### Returns

`AsyncIterable`\<`string`\>
