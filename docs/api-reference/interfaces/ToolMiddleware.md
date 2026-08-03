[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolMiddleware

# Interface: ToolMiddleware

Defined in: src/core/agent/middleware/types.ts:156

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

Defined in: src/core/agent/middleware/types.ts:158

Identifies this middleware in every ledger row and event it produces.

## Methods

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md) \| `Promise`\<[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md)\>

Defined in: src/core/agent/middleware/types.ts:159

#### Parameters

##### call

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md)

#### Returns

[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md) \| `Promise`\<[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md)\>
