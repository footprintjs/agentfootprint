---
title: FlowSubflowEvent
---

# Interface: FlowSubflowEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:248

Event passed to FlowRecorder.onSubflow.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:253

Build-time description of what this subflow does.

***

### mappedInput?

> `optional` **mappedInput?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:256

Mapped input values sent INTO the subflow (from inputMapper/inputKeys). Present on entry events.

***

### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:249

***

### outputState?

> `optional` **outputState?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:258

Subflow shared state at exit. Present on exit events.

***

### subflowId?

> `optional` **subflowId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:251

Subflow identifier — use this to look up the full spec via the manifest.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:254
