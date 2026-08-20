[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultMiddleware

# Interface: ToolResultMiddleware

Defined in: [src/core/agent/middleware/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L250)

A link that decides only about the RESULT. It takes no part in dispatch.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L240)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

***

### onToolCall?

> `optional` **onToolCall?**: `undefined`

Defined in: [src/core/agent/middleware/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L251)

## Methods

### onToolResult()

> **onToolResult**(`call`): [`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L252)

#### Parameters

##### call

[`ToolResultContext`](/agentfootprint/api/generated/interfaces/ToolResultContext.md)

#### Returns

[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>
