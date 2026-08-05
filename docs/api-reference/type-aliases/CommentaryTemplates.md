[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CommentaryTemplates

# Type Alias: CommentaryTemplates

> **CommentaryTemplates** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:49](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/recorders/observability/commentary/commentaryTemplates.ts#L49)

Flat map of template keys to template strings. Keys use a dotted
 hierarchy mirroring event types + payload branches
 (`'stream.llm_start.iter1'`, `'context.injected.rag'`). Values may
 contain `{{name}}` placeholders that `renderCommentary` substitutes.
