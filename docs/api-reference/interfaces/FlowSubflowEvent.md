[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowSubflowEvent

# Interface: FlowSubflowEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:190

Event passed to FlowRecorder.onSubflow.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:195

Build-time description of what this subflow does.

***

### mappedInput?

> `optional` **mappedInput?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:198

Mapped input values sent INTO the subflow (from inputMapper/inputKeys). Present on entry events.

***

### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:191

***

### outputState?

> `optional` **outputState?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:200

Subflow shared state at exit. Present on exit events.

***

### subflowId?

> `optional` **subflowId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:193

Subflow identifier — use this to look up the full spec via the manifest.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/agentfootprint/api/generated/interfaces/TraversalContext.md)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:196
