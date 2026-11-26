---
title: FlowchartHandle
---

# Interface: FlowchartHandle

Defined in: [src/recorders/observability/FlowchartRecorder.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L210)

## Properties

### boundary

> `readonly` **boundary**: `BoundaryRecorder`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L217)

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => `StepGraph`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L213)

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

`StepGraph`

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L219)

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
