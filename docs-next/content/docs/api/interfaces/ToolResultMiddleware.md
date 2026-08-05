---
title: ToolResultMiddleware
---

# Interface: ToolResultMiddleware

Defined in: [src/core/agent/middleware/types.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L242)

A link that decides only about the RESULT. It takes no part in dispatch.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L232)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

***

### onToolCall?

> `optional` **onToolCall?**: `undefined`

Defined in: [src/core/agent/middleware/types.ts:243](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L243)

## Methods

### onToolResult()

> **onToolResult**(`call`): [`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:244](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L244)

#### Parameters

##### call

[`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

#### Returns

[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>
