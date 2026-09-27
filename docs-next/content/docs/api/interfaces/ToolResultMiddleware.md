---
title: ToolResultMiddleware
---

# Interface: ToolResultMiddleware

Defined in: [src/core/agent/middleware/types.ts:262](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L262)

A link that decides only about the RESULT. It takes no part in dispatch.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L252)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

***

### onToolCall?

> `optional` **onToolCall?**: `undefined`

Defined in: [src/core/agent/middleware/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L263)

## Methods

### onToolResult()

> **onToolResult**(`call`): [`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:264](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L264)

#### Parameters

##### call

[`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

#### Returns

[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>
