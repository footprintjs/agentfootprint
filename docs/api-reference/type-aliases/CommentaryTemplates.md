[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CommentaryTemplates

# Type Alias: CommentaryTemplates

> **CommentaryTemplates** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:49](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/recorders/observability/commentary/commentaryTemplates.ts#L49)

Flat map of template keys to template strings. Keys use a dotted
 hierarchy mirroring event types + payload branches
 (`'stream.llm_start.iter1'`, `'context.injected.rag'`). Values may
 contain `{{name}}` placeholders that `renderCommentary` substitutes.
