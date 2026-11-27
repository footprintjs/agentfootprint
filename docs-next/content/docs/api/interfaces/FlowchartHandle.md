---
title: FlowchartHandle
---

# Interface: FlowchartHandle

Defined in: [src/recorders/observability/FlowchartRecorder.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L84)

## Properties

### boundary

> `readonly` **boundary**: `BoundaryRecorder`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L91)

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => `StepGraph`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L87)

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

`StepGraph`

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L93)

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
