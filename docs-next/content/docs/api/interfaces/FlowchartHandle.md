---
title: FlowchartHandle
---

# Interface: FlowchartHandle

Defined in: src/recorders/observability/FlowchartRecorder.ts:190

## Properties

### boundary

> `readonly` **boundary**: `BoundaryRecorder`

Defined in: src/recorders/observability/FlowchartRecorder.ts:197

Underlying BoundaryRecorder. Use for richer queries — slot data,
 full event log, type-narrowed lookups. The single source of truth
 Lens reads.

***

### getSnapshot

> `readonly` **getSnapshot**: () => `StepGraph`

Defined in: src/recorders/observability/FlowchartRecorder.ts:193

Current step graph (derived from boundary events). Safe during or
 after a run.

#### Returns

`StepGraph`

***

### unsubscribe

> `readonly` **unsubscribe**: () => `void`

Defined in: src/recorders/observability/FlowchartRecorder.ts:199

Detach from executor + dispatcher. Subsequent events ignored.

#### Returns

`void`
