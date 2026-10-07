---
title: FlowSubflowEvent
---

# Interface: FlowSubflowEvent

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:252

Event passed to FlowRecorder.onSubflow.

## Properties

### description?

> `optional` **description?**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:257

Build-time description of what this subflow does.

***

### mappedInput?

> `optional` **mappedInput?**: `Record`\<`string`, `unknown`\>

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:260

Mapped input values sent INTO the subflow (from inputMapper/inputKeys). Present on entry events.

***

### name

> **name**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:253

***

### outputState?

> `optional` **outputState?**: `Record`\<`string`, `unknown`\>

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:262

Subflow shared state at exit. Present on exit events.

***

### subflowId?

> `optional` **subflowId?**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:255

Subflow identifier — use this to look up the full spec via the manifest.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:258
