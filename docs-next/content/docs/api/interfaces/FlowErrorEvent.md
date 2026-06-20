---
title: FlowErrorEvent
---

# Interface: FlowErrorEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:258

Event passed to FlowRecorder.onError.

## Properties

### channel?

> `optional` **channel?**: `"flow"`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:270

Explicit channel discriminant — `'flow'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-absence heuristic.

***

### message

> **message**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:260

***

### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:259

***

### structuredError

> **structuredError**: `StructuredErrorInfo`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:262

Structured error details — preserves field-level issues, error codes, etc.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:263
