---
title: ToolMiddleware
---

# Interface: ToolMiddleware

Defined in: [src/core/agent/middleware/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L168)

One link in the tool-dispatch chain.

## Example

```ts
const noProdWrites: ToolMiddleware = {
  name: 'no-prod-writes',
  onToolCall: (call) =>
    call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
};
```

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L170)

Identifies this middleware in every ledger row and event it produces.

## Methods

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L171)

#### Parameters

##### call

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext)

#### Returns

[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>
