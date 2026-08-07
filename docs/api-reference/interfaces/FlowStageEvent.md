[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowStageEvent

# Interface: FlowStageEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:173

Event passed to FlowRecorder.onStageExecuted.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:175

***

### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:174

***

### stageType

> **stageType**: `StageType`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:183

Which kind of stage completed. The engine fires `onStageExecuted`
uniformly for every stage kind (proposal #003); consumers route by
`stageType` without a chart-spec lookup.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/agentfootprint/api/generated/interfaces/TraversalContext.md)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:177

Traversal context from the engine — read-only, set by traverser.
