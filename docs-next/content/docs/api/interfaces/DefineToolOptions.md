---
title: DefineToolOptions<TArgs, TResult>
---

# Interface: DefineToolOptions\<TArgs, TResult\>

Defined in: [src/core/tools.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L72)

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

### description

> `readonly` **description**: `string`

Defined in: [src/core/tools.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L74)

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/tools.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L75)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/tools.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L73)

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L78)

Declare a credential this tool needs (declare-and-push). Resolved by the
 framework before `execute` and injected as `ctx.credential`.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L79)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
