[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / buildEventMeta

# Function: buildEventMeta()

> **buildEventMeta**(`origin`, `run`): [`EventMeta`](/agentfootprint/api/generated/interfaces/EventMeta.md)

Defined in: [src/bridge/eventMeta.ts:59](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/bridge/eventMeta.ts#L59)

Build an EventMeta from a stage origin + run-level context.

Accepts footprintjs's TraversalContext (FlowRecorder events), RecorderContext
(WriteEvent / CommitEvent / etc.), or a bare StageOrigin. When the origin
has no runtimeStageId (rare — manual emit during tests), the meta degrades
gracefully to 'unknown#0'.

## Parameters

### origin

[`TraversalContext`](/agentfootprint/api/generated/interfaces/TraversalContext.md) \| `StageOrigin` \| `undefined`

### run

[`RunContext`](/agentfootprint/api/generated/interfaces/RunContext.md)

## Returns

[`EventMeta`](/agentfootprint/api/generated/interfaces/EventMeta.md)
