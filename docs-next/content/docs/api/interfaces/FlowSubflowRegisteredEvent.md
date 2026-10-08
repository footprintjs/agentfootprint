---
title: FlowSubflowRegisteredEvent
---

# Interface: FlowSubflowRegisteredEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:265

Event passed to FlowRecorder.onSubflowRegistered (dynamic subflow attachment).

## Properties

### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:271

Build-time description.

***

### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:269

Human-readable name.

***

### specStructure?

> `optional` **specStructure?**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:273

Full spec structure (when available from buildTimeStructure).

***

### subflowId

> **subflowId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:267

Subflow identifier.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:274
