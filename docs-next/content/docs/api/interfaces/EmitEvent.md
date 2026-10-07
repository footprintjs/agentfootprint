---
title: EmitEvent
---

# Interface: EmitEvent

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:70

Event delivered to `EmitRecorder.onEmit`.

Name + payload are consumer-supplied via `scope.$emit(name, payload)`.
Everything else is library-enriched at dispatch time from the current
stage's execution context.

## Properties

### name

> `readonly` **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:77

Consumer-supplied event name. Convention: hierarchical dotted namespace
(e.g. `'agentfootprint.llm.tokens'`, `'myapp.billing.spend'`). Keeps
vocabularies collision-free across libraries/apps without requiring a
central registry.

***

### payload

> `readonly` **payload**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:85

Consumer-supplied payload. Shape is up to the consumer and their
convention; library treats it as opaque and passes through unchanged
(modulo redaction — see `RedactionPolicy.emitPatterns`).

When redacted, replaced with the string `'[REDACTED]'`.

***

### pipelineId

> `readonly` **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:101

Pipeline/run identifier (matches `RecorderContext.pipelineId`).

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:92

Unique per-execution-step identifier — the same value recorder events
and commit-log entries carry. See `runtimeStageId.ts` for format.

***

### sourcePosition?

> `readonly` `optional` **sourcePosition?**: `EmitSourcePosition`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:111

Source-time committed prefix in this stage's own log, captured before
observer dispatch. Not this stage's future commit or uncommitted state.
Match logRunId + drillPath against the source's logAddress before folding;
a named nested history can be unavailable (e.g. a paused subflow).
Absent on old/manual events and scopes without a bound engine log.

***

### stageName

> `readonly` **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:87

Name of the stage that emitted this event.

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:99

Subflow path from the outermost parent down to the subflow that emitted
this event. Empty array when the emit came from the root flowchart.
Matches the convention used by `FlowPauseEvent.subflowPath`,
`FlowchartCheckpoint.subflowPath`, etc.

***

### timestamp

> `readonly` **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:103

Emission timestamp in milliseconds since epoch (`Date.now()`).
