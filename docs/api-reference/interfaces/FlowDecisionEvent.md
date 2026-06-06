[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowDecisionEvent

# Interface: FlowDecisionEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:165

Event passed to FlowRecorder.onDecision.

## Properties

### chosen

> **chosen**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:167

***

### decider

> **decider**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:166

***

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:169

***

### evidence?

> `optional` **evidence?**: `DecisionEvidence`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:172

Structured decision evidence from decide() helper.

***

### rationale?

> `optional` **rationale?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:168

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/agentfootprint/api/generated/interfaces/TraversalContext.md)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:170
