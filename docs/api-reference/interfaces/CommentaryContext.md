[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CommentaryContext

# Interface: CommentaryContext

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:374](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/recorders/observability/commentary/commentaryTemplates.ts#L374)

Context the var-extractor reads from. Anything that's NOT in the
 event payload (consumer-supplied appName, tool registry lookup) goes
 here. Pure data — no closures, no I/O.

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:377](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/recorders/observability/commentary/commentaryTemplates.ts#L377)

The system that orchestrates the LLM. Substituted as the active
 actor in every line ("Acme called the LLM"). Default: `'Chatbot'`.

***

### getToolDescription?

> `readonly` `optional` **getToolDescription?**: (`toolName`) => `string` \| `undefined`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:382](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/recorders/observability/commentary/commentaryTemplates.ts#L382)

Resolves a tool name to its registered description ("Get current
 weather for a city"). Used to compose the optional `descClause`
 for `stream.tool_start`. Sync — Lens-style consumers precompute
 the lookup map from `context.injected source='registry'` events.

#### Parameters

##### toolName

`string`

#### Returns

`string` \| `undefined`
