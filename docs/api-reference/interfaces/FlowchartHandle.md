[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartHandle

# Interface: FlowchartHandle

Defined in: [src/recorders/observability/FlowchartRecorder.ts:185](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/FlowchartRecorder.ts#L185)

## Properties

### boundary

> `readonly` **boundary**: [`BoundaryRecorder`](/agentfootprint/api/generated/classes/BoundaryRecorder.md)

Defined in: [src/recorders/observability/FlowchartRecorder.ts:192](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/FlowchartRecorder.ts#L192)

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => [`StepGraph`](/agentfootprint/api/generated/interfaces/StepGraph.md)

Defined in: [src/recorders/observability/FlowchartRecorder.ts:188](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/FlowchartRecorder.ts#L188)

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

[`StepGraph`](/agentfootprint/api/generated/interfaces/StepGraph.md)

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:194](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/FlowchartRecorder.ts#L194)

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
