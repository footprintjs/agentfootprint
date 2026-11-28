---
title: ToolResultMiddleware
---

# Interface: ToolResultMiddleware

Defined in: [src/core/agent/middleware/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L280)

A link that decides only about the RESULT. It takes no part in dispatch.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L270)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

***

### onToolCall?

> `optional` **onToolCall?**: `undefined`

Defined in: [src/core/agent/middleware/types.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L281)

## Methods

### admitToolResultEffects()?

> `optional` **admitToolResultEffects**(`result`): readonly [`ToolResultEffectProposal`](/docs/api/interfaces/ToolResultEffectProposal)[] \| `Promise`\<readonly [`ToolResultEffectProposal`](/docs/api/interfaces/ToolResultEffectProposal)[]\>

Defined in: [src/core/agent/middleware/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L265)

Approve exact original proposals against bounded, final rewritten content.

#### Parameters

##### result

[`ToolResultEffectPolicyContext`](/docs/api/interfaces/ToolResultEffectPolicyContext)

#### Returns

readonly [`ToolResultEffectProposal`](/docs/api/interfaces/ToolResultEffectProposal)[] \| `Promise`\<readonly [`ToolResultEffectProposal`](/docs/api/interfaces/ToolResultEffectProposal)[]\>

#### Inherited from

`ToolMiddlewareIdentity.admitToolResultEffects`

***

### onToolResult()

> **onToolResult**(`call`): [`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L282)

#### Parameters

##### call

[`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

#### Returns

[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>
