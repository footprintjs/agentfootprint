[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolMiddleware

# Type Alias: ToolMiddleware

> **ToolMiddleware** = [`ToolCallMiddleware`](/agentfootprint/api/generated/interfaces/ToolCallMiddleware.md) \| [`ToolResultMiddleware`](/agentfootprint/api/generated/interfaces/ToolResultMiddleware.md)

Defined in: [src/core/agent/middleware/types.ts:273](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/core/agent/middleware/types.ts#L273)

One link in the tool chain — a rule about the call, about the result, or
about both.

The union is the point: an object with a `name` and no hook would be a
governance rule that silently never runs, so it does not type-check. Which
hooks a link has is what decides where it speaks — never which list it was
written in.

## Example

```ts
const noProdWrites: ToolMiddleware = {
  name: 'no-prod-writes',
  onToolCall: (call) =>
    call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
};

const hideRawPII: ToolMiddleware = {
  name: 'hide-raw-pii',
  onToolResult: (call) =>
    hasSSN(call.result)
      ? deny('the record exists but its raw contents are not for the model')
      : allow(),
};
```
