[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartHandle

# Interface: FlowchartHandle

Defined in: [src/recorders/observability/FlowchartRecorder.ts:190](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/recorders/observability/FlowchartRecorder.ts#L190)

## Properties

### boundary

> `readonly` **boundary**: `BoundaryRecorder`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:197](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/recorders/observability/FlowchartRecorder.ts#L197)

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => `StepGraph`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:193](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/recorders/observability/FlowchartRecorder.ts#L193)

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

`StepGraph`

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:199](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/recorders/observability/FlowchartRecorder.ts#L199)

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
