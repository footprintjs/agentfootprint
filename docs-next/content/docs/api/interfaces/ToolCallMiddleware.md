---
title: ToolCallMiddleware
---

# Interface: ToolCallMiddleware

Defined in: [src/core/agent/middleware/types.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L274)

A link that decides about the CALL, and may also decide about the result.

## Extends

- `ToolMiddlewareIdentity`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L270)

Identifies this middleware in every ledger row and event it produces.

#### Inherited from

`ToolMiddlewareIdentity.name`

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

### onToolCall()

> **onToolCall**(`call`): [`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L275)

#### Parameters

##### call

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext)

#### Returns

[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome) \| `Promise`\<[`ToolOutcome`](/docs/api/type-aliases/ToolOutcome)\>

***

### onToolResult()?

> `optional` **onToolResult**(`call`): [`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:276](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L276)

#### Parameters

##### call

[`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

#### Returns

[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome) \| `Promise`\<[`ToolResultOutcome`](/docs/api/type-aliases/ToolResultOutcome)\>
