[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / extractAgentName

# Function: extractAgentName()

> **extractAgentName**(`event`, `ctx`): `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:438](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/recorders/observability/commentary/commentaryTemplates.ts#L438)

Resolve the agent name from an event's `meta.subflowPath`.

Walks the path right-to-left, skipping library-internal segments
(slot subflows, agent-routing subflows, thinking handlers), and
returns the FIRST meaningful segment with the optional `step-`
Sequence prefix stripped. For events with no meaningful path
(single-Agent runners, top-level events), falls back to `appName`.

## Parameters

### event

`AgentfootprintEvent`

### ctx

[`CommentaryContext`](/agentfootprint/api/generated/interfaces/CommentaryContext.md)

## Returns

`string`
