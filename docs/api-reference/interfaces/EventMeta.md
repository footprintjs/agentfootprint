[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EventMeta

# Interface: EventMeta

Defined in: [agentfootprint/src/events/types.ts:76](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L76)

Metadata attached by the dispatcher to every event. Consumers never
construct this manually — the dispatcher fills it in.

## Properties

### compositionPath

> `readonly` **compositionPath**: readonly `string`[]

Defined in: [agentfootprint/src/events/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L86)

Composition ancestry — e.g. ['Sequence:pipeline','Agent:ethics'].

***

### correlationId?

> `readonly` `optional` **correlationId?**: `string`

Defined in: [agentfootprint/src/events/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L96)

Domain correlation id — ties retrieval → injection → LLM.

***

### iterIndex?

> `readonly` `optional` **iterIndex?**: `number`

Defined in: [agentfootprint/src/events/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L90)

Iteration index (Agent context only).

***

### runId

> `readonly` **runId**: `string`

Defined in: [agentfootprint/src/events/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L98)

Run id — demultiplex concurrent runs sharing one dispatcher.

***

### runOffsetMs

> `readonly` **runOffsetMs**: `number`

Defined in: [agentfootprint/src/events/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L80)

ms since run start — deterministic replay.

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [agentfootprint/src/events/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L82)

footprintjs universal stage key.

***

### spanId?

> `readonly` `optional` **spanId?**: `string`

Defined in: [agentfootprint/src/events/types.ts:94](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L94)

OTEL span id for the current composition boundary.

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [agentfootprint/src/events/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L84)

Subflow path parsed from runtimeStageId.

***

### traceId?

> `readonly` `optional` **traceId?**: `string`

Defined in: [agentfootprint/src/events/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L92)

OTEL trace id (when env.traceId is set).

***

### turnIndex?

> `readonly` `optional` **turnIndex?**: `number`

Defined in: [agentfootprint/src/events/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L88)

Turn index (Agent context only).

***

### wallClockMs

> `readonly` **wallClockMs**: `number`

Defined in: [agentfootprint/src/events/types.ts:78](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L78)

Wall-clock ms — for external correlation / dashboards.
