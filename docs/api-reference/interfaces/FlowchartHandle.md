[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartHandle

# Interface: FlowchartHandle

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:176](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L176)

## Properties

### boundary

> `readonly` **boundary**: [`BoundaryRecorder`](/agentfootprint/api/generated/classes/BoundaryRecorder.md)

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:183](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L183)

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => [`StepGraph`](/agentfootprint/api/generated/interfaces/StepGraph.md)

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:179](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L179)

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

[`StepGraph`](/agentfootprint/api/generated/interfaces/StepGraph.md)

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:185](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L185)

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
