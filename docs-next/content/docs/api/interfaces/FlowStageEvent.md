---
title: FlowStageEvent
---

# Interface: FlowStageEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:203

Event passed to FlowRecorder.onStageExecuted.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:205

***

### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:204

***

### stageType

> **stageType**: `StageType`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:213

Which kind of stage completed. The engine fires `onStageExecuted`
uniformly for every stage kind (proposal #003); consumers route by
`stageType` without a chart-spec lookup.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:207

Traversal context from the engine — read-only, set by traverser.
