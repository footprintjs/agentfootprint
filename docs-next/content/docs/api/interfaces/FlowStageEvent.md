---
title: FlowStageEvent
---

# Interface: FlowStageEvent

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:207

Event passed to FlowRecorder.onStageExecuted.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:209

***

### stageName

> **stageName**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:208

***

### stageType

> **stageType**: `StageType`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:217

Which kind of stage completed. The engine fires `onStageExecuted`
uniformly for every stage kind (proposal #003); consumers route by
`stageType` without a chart-spec lookup.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:211

Traversal context from the engine — read-only, set by traverser.
