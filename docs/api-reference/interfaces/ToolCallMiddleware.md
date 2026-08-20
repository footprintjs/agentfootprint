[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolCallMiddleware

# Interface: ToolCallMiddleware

Defined in: [src/core/agent/middleware/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L244)

A link that decides about the CALL, and may also decide about the result.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L240)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

## Methods

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md) \| `Promise`\<[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L245)

#### Parameters

##### call

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md)

#### Returns

[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md) \| `Promise`\<[`ToolOutcome`](/agentfootprint/api/generated/type-aliases/ToolOutcome.md)\>

***

### onToolResult()?

> `optional` **onToolResult**(`call`): [`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:246](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L246)

#### Parameters

##### call

[`ToolResultContext`](/agentfootprint/api/generated/interfaces/ToolResultContext.md)

#### Returns

[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>
