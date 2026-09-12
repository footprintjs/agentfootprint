---
title: FlowErrorEvent
---

# Interface: FlowErrorEvent

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:269

Event passed to FlowRecorder.onError.

## Properties

### channel?

> `optional` **channel?**: `"flow"`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:281

Explicit channel discriminant — `'flow'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-absence heuristic.

***

### message

> **message**: `string`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:271

***

### stageName

> **stageName**: `string`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:270

***

### structuredError

> **structuredError**: `StructuredErrorInfo`

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:273

Structured error details — preserves field-level issues, error codes, etc.

***

### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: ../../../../Users/sanjay/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/agentfootprint-answer-validation/node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:274
