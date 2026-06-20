---
title: buildEventMeta
---

# Function: buildEventMeta()

> **buildEventMeta**(`origin`, `run`): [`EventMeta`](/docs/api/interfaces/EventMeta)

Defined in: [src/bridge/eventMeta.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/bridge/eventMeta.ts#L59)

Build an EventMeta from a stage origin + run-level context.

Accepts footprintjs's TraversalContext (FlowRecorder events), RecorderContext
(WriteEvent / CommitEvent / etc.), or a bare StageOrigin. When the origin
has no runtimeStageId (rare — manual emit during tests), the meta degrades
gracefully to 'unknown#0'.

## Parameters

### origin

[`TraversalContext`](/docs/api/interfaces/TraversalContext) \| `StageOrigin` \| `undefined`

### run

[`RunContext`](/docs/api/interfaces/RunContext)

## Returns

[`EventMeta`](/docs/api/interfaces/EventMeta)
