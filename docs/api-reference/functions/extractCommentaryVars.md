[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / extractCommentaryVars

# Function: extractCommentaryVars()

> **extractCommentaryVars**(`event`, `ctx`, `templates?`): `Record`\<`string`, `string`\>

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:287](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/recorders/observability/commentary/commentaryTemplates.ts#L287)

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
