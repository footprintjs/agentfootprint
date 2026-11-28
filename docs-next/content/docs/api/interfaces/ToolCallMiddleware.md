---
title: ToolCallMiddleware
---

# Interface: ToolCallMiddleware

Defined in: [src/core/agent/middleware/types.ts:257](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L257)

A link that decides about the CALL, and may also decide about the result.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:253](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L253)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

## Methods

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:258](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L258)

#### Parameters

##### call

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext)

#### Returns

[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>

***

### onToolResult()?

> `optional` **onToolResult**(`call`): [`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L259)

#### Parameters

##### call

[`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

#### Returns

[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>
