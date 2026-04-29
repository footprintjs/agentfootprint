[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CommentaryTemplates

# Type Alias: CommentaryTemplates

> **CommentaryTemplates** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [agentfootprint/src/recorders/observability/commentary/commentaryTemplates.ts:49](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/commentary/commentaryTemplates.ts#L49)

Flat map of template keys to template strings. Keys use a dotted
 hierarchy mirroring event types + payload branches
 (`'stream.llm_start.iter1'`, `'context.injected.rag'`). Values may
 contain `{{name}}` placeholders that `renderCommentary` substitutes.
