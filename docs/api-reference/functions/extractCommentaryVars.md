[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / extractCommentaryVars

# Function: extractCommentaryVars()

> **extractCommentaryVars**(`event`, `ctx`, `templates?`): `Record`\<`string`, `string`\>

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:278](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/recorders/observability/commentary/commentaryTemplates.ts#L278)

Build the variable bag for a given event. Flat `name → string` map;
`renderCommentary` substitutes by name. Templates use whatever names
this function produces.

Two-step composition for `stream.tool_start`: the optional
`descClause` is a rendered sub-template. We pre-render it here so
the outer template stays a single non-recursive substitution pass.

## Parameters

### event

`AgentfootprintEvent`

### ctx

[`CommentaryContext`](/agentfootprint/api/generated/interfaces/CommentaryContext.md)

### templates?

[`CommentaryTemplates`](/agentfootprint/api/generated/type-aliases/CommentaryTemplates.md) = `defaultCommentaryTemplates`

## Returns

`Record`\<`string`, `string`\>
