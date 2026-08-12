[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultMiddleware

# Interface: ToolResultMiddleware

Defined in: [src/core/agent/middleware/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/agent/middleware/types.ts#L242)

A link that decides only about the RESULT. It takes no part in dispatch.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/agent/middleware/types.ts#L232)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

***

### onToolCall?

> `optional` **onToolCall?**: `undefined`

Defined in: [src/core/agent/middleware/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/agent/middleware/types.ts#L243)

## Methods

### onToolResult()

> **onToolResult**(`call`): [`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/24f3a16bbef9acd26a5962541c0f75306264a97a/src/core/agent/middleware/types.ts#L244)

#### Parameters

##### call

[`ToolResultContext`](/agentfootprint/api/generated/interfaces/ToolResultContext.md)

#### Returns

[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md) \| `Promise`\<[`ToolResultOutcome`](/agentfootprint/api/generated/type-aliases/ToolResultOutcome.md)\>
