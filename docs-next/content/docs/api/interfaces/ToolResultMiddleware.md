---
title: ToolResultMiddleware
---

# Interface: ToolResultMiddleware

Defined in: [src/core/agent/middleware/types.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L250)

A link that decides only about the RESULT. It takes no part in dispatch.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L240)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

***

### onToolCall?

> `optional` **onToolCall?**: `undefined`

Defined in: [src/core/agent/middleware/types.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L251)

## Methods

### onToolResult()

> **onToolResult**(`call`): [`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L252)

#### Parameters

##### call

[`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

#### Returns

[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>
