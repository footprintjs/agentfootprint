---
title: CommentaryContext
---

# Interface: CommentaryContext

Defined in: [src/recorders/observability/commentary/commentaryTemplates/types.ts:10](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/commentary/commentaryTemplates/types.ts#L10)

Context the var-extractor reads from. Anything that's NOT in the
 event payload (consumer-supplied appName, tool registry lookup) goes
 here. Pure data — no closures, no I/O.

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates/types.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/commentary/commentaryTemplates/types.ts#L13)

The system that orchestrates the LLM. Substituted as the active
 actor in every line ("Acme called the LLM"). Default: `'Chatbot'`.

***

### getToolDescription?

> `readonly` `optional` **getToolDescription?**: (`toolName`) => `string` \| `undefined`

Defined in: [src/recorders/observability/commentary/commentaryTemplates/types.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/commentary/commentaryTemplates/types.ts#L18)

Resolves a tool name to its registered description ("Get current
 weather for a city"). Used to compose the optional `descClause`
 for `stream.tool_start`. Sync — Lens-style consumers precompute
 the lookup map from `context.injected source='registry'` events.

#### Parameters

##### toolName

`string`

#### Returns

`string` \| `undefined`
