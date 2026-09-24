[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartHandle

# Interface: FlowchartHandle

Defined in: [src/recorders/observability/FlowchartRecorder.ts:193](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/recorders/observability/FlowchartRecorder.ts#L193)

## Properties

### boundary

> `readonly` **boundary**: `BoundaryRecorder`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:200](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/recorders/observability/FlowchartRecorder.ts#L200)

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => `StepGraph`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:196](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/recorders/observability/FlowchartRecorder.ts#L196)

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

`StepGraph`

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:202](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/recorders/observability/FlowchartRecorder.ts#L202)

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
