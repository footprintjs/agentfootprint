---
title: extractAgentName
---

# Function: extractAgentName()

> **extractAgentName**(`event`, `ctx`): `string`

Defined in: [src/recorders/observability/commentary/commentaryTemplates.ts:402](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/observability/commentary/commentaryTemplates.ts#L402)

Resolve the agent name from an event's `meta.subflowPath`.

Walks the path right-to-left, skipping library-internal segments
(slot subflows, agent-routing subflows, thinking handlers), and
returns the FIRST meaningful segment with the optional `step-`
Sequence prefix stripped. For events with no meaningful path
(single-Agent runners, top-level events), falls back to `appName`.

## Parameters

### event

[`AgentfootprintEvent`](/docs/api/type-aliases/AgentfootprintEvent)

### ctx

[`CommentaryContext`](/docs/api/interfaces/CommentaryContext)

## Returns

`string`
