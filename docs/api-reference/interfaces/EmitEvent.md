[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmitEvent

# Interface: EmitEvent

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:69

Event delivered to `EmitRecorder.onEmit`.

Name + payload are consumer-supplied via `scope.$emit(name, payload)`.
Everything else is library-enriched at dispatch time from the current
stage's execution context.

## Properties

### name

> `readonly` **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:76

Consumer-supplied event name. Convention: hierarchical dotted namespace
(e.g. `'agentfootprint.llm.tokens'`, `'myapp.billing.spend'`). Keeps
vocabularies collision-free across libraries/apps without requiring a
central registry.

***

### payload

> `readonly` **payload**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:84

Consumer-supplied payload. Shape is up to the consumer and their
convention; library treats it as opaque and passes through unchanged
(modulo redaction — see `RedactionPolicy.emitPatterns`).

When redacted, replaced with the string `'[REDACTED]'`.

***

### pipelineId

> `readonly` **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:100

Pipeline/run identifier (matches `RecorderContext.pipelineId`).

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:91

Unique per-execution-step identifier — the same value recorder events
and commit-log entries carry. See `runtimeStageId.ts` for format.

***

### stageName

> `readonly` **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:86

Name of the stage that emitted this event.

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:98

Subflow path from the outermost parent down to the subflow that emitted
this event. Empty array when the emit came from the root flowchart.
Matches the convention used by `FlowPauseEvent.subflowPath`,
`FlowchartCheckpoint.subflowPath`, etc.

***

### timestamp

> `readonly` **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:102

Emission timestamp in milliseconds since epoch (`Date.now()`).
