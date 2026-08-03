---
title: ToolMiddleware
---

# Interface: ToolMiddleware

Defined in: [src/core/agent/middleware/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L156)

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

Defined in: [src/core/agent/middleware/types.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L158)

Identifies this middleware in every ledger row and event it produces.

## Methods

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L159)

#### Parameters

##### call

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext)

#### Returns

[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>
