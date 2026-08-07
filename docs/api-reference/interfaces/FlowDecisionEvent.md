[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowDecisionEvent

# Interface: FlowDecisionEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:193

Event passed to FlowRecorder.onDecision.

## Properties

### chosen

> **chosen**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:195

***

### decider

> **decider**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:194

***

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:197

***

### evidence?

> `optional` **evidence?**: `DecisionEvidence`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:200

Structured decision evidence from decide() helper.

***

### rationale?

> `optional` **rationale?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:196

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/agentfootprint/api/generated/interfaces/TraversalContext.md)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:198
