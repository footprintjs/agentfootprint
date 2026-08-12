[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CommentaryContext

# Interface: CommentaryContext

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:158](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/recorders/observability/commentary/commentaryTemplates.ts#L158)

Context the var-extractor reads from. Anything that's NOT in the
 event payload (consumer-supplied appName, tool registry lookup) goes
 here. Pure data — no closures, no I/O.

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:161](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/recorders/observability/commentary/commentaryTemplates.ts#L161)

The system that orchestrates the LLM. Substituted as the active
 actor in every line ("Acme called the LLM"). Default: `'Chatbot'`.

***

### getToolDescription?

> `readonly` `optional` **getToolDescription?**: (`toolName`) => `string` \| `undefined`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:166](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/recorders/observability/commentary/commentaryTemplates.ts#L166)

Resolves a tool name to its registered description ("Get current
 weather for a city"). Used to compose the optional `descClause`
 for `stream.tool_start`. Sync — Lens-style consumers precompute
 the lookup map from `context.injected source='registry'` events.

#### Parameters

##### toolName

`string`

#### Returns

`string` \| `undefined`
