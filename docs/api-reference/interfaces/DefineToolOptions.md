[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DefineToolOptions

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: [src/core/tools.ts:180](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L180)

Convenience input for `defineTool` — flatter than `Tool` itself.
Consumers describe the tool inline; the helper assembles `schema`.

`inputSchema` is a JSON Schema object (the same one the LLM will
see). For tools that take no arguments, pass `{ type: 'object',
properties: {} }` or omit and we'll default to that.

## Type Parameters

### TArgs

`TArgs`

### TResult

`TResult`

## Properties

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)\<`TArgs`\>

Defined in: [src/core/tools.ts:189](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L189)

Demand a human check-in before this tool runs (see [Tool.checkIn](/agentfootprint/api/generated/interfaces/Tool.md#checkin)).
 `'always'` or a `(args, ctx) => boolean` predicate.

***

### description

> `readonly` **description**: `string`

Defined in: [src/core/tools.ts:182](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L182)

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/tools.ts:183](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L183)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/tools.ts:181](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L181)

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:186](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L186)

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:190](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/tools.ts#L190)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
