[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolCallMiddleware

# Interface: ToolCallMiddleware

Defined in: [src/core/agent/middleware/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L236)

A link that decides about the CALL, and may also decide about the result.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L232)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

## Methods

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md) \| `Promise`\<[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:237](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L237)

#### Parameters

##### call

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md)

#### Returns

[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md) \| `Promise`\<[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md)\>

***

### onToolResult()?

> `optional` **onToolResult**(`call`): [`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:238](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L238)

#### Parameters

##### call

[`ToolResultContext`](/agentfootprint/api/generated/interfaces/ToolResultContext.md)

#### Returns

[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>
