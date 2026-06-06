[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / extractCommentaryVars

# Function: extractCommentaryVars()

> **extractCommentaryVars**(`event`, `ctx`, `templates?`): `Record`\<`string`, `string`\>

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:263](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/recorders/observability/commentary/commentaryTemplates.ts#L263)

Build the variable bag for a given event. Flat `name → string` map;
`renderCommentary` substitutes by name. Templates use whatever names
this function produces.

Two-step composition for `stream.tool_start`: the optional
`descClause` is a rendered sub-template. We pre-render it here so
the outer template stays a single non-recursive substitution pass.

## Parameters

### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

### ctx

[`CommentaryContext`](/agentfootprint/api/generated/interfaces/CommentaryContext.md)

### templates?

[`CommentaryTemplates`](/agentfootprint/api/generated/type-aliases/CommentaryTemplates.md) = `defaultCommentaryTemplates`

## Returns

`Record`\<`string`, `string`\>
