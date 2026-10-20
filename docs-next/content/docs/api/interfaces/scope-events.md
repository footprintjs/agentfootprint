---
title: Scope event payloads
description: Related recorder payloads, with a section for each interface.
---


## Interface: CommitEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:37

### Extends

- `RecorderContext`

### Properties

#### correlation?

> `readonly` `optional` **correlation?**: `RunCorrelation`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:22

The run's correlation (10.1) — the same frozen object as `TraversalContext.correlation` on the flow events
and `getSnapshot().correlation`. Absent — no key — when the run's env gave none.

##### Inherited from

`RecorderContext.correlation`

***

#### mutations

> **mutations**: `object`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:38

##### key

> **key**: `string`

##### operation

> **operation**: `"set"` \| `"update"` \| `"delete"`

##### value

> **value**: `unknown`

***

#### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:16

##### Inherited from

`RecorderContext.pipelineId`

***

#### runtimeStageId

> **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

##### Inherited from

`RecorderContext.runtimeStageId`

***

#### stageId

> **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:13

Stable stage identifier (matches spec node id).

##### Inherited from

`RecorderContext.stageId`

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:11

##### Inherited from

`RecorderContext.stageName`

***

#### timestamp

> **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:17

##### Inherited from

`RecorderContext.timestamp`


---


## Interface: EmitEvent

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:71

Event delivered to `EmitRecorder.onEmit`.

Name + payload are consumer-supplied via `scope.$emit(name, payload)`.
Everything else is library-enriched at dispatch time from the current
stage's execution context.

### Properties

#### correlation?

> `readonly` `optional` **correlation?**: `RunCorrelation`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:114

The run's correlation (10.1) — as on every scope event (`RecorderContext.correlation`). Absent when none.

***

#### name

> `readonly` **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:78

Consumer-supplied event name. Convention: hierarchical dotted namespace
(e.g. `'agentfootprint.llm.tokens'`, `'myapp.billing.spend'`). Keeps
vocabularies collision-free across libraries/apps without requiring a
central registry.

***

#### payload

> `readonly` **payload**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:86

Consumer-supplied payload. Shape is up to the consumer and their
convention; library treats it as opaque and passes through unchanged
(modulo redaction — see `RedactionPolicy.emitPatterns`).

When redacted, replaced with the string `'[REDACTED]'`.

***

#### pipelineId

> `readonly` **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:102

Pipeline/run identifier (matches `RecorderContext.pipelineId`).

***

#### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:93

Unique per-execution-step identifier — the same value recorder events
and commit-log entries carry. See `runtimeStageId.ts` for format.

***

#### sourcePosition?

> `readonly` `optional` **sourcePosition?**: `EmitSourcePosition`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:112

Source-time committed prefix in this stage's own log, captured before
observer dispatch. Not this stage's future commit or uncommitted state.
Match logRunId + drillPath against the source's logAddress before folding;
a named nested history can be unavailable (e.g. a paused subflow).
Absent on old/manual events and scopes without a bound engine log.

***

#### stageName

> `readonly` **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:88

Name of the stage that emitted this event.

***

#### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:100

Subflow path from the outermost parent down to the subflow that emitted
this event. Empty array when the emit came from the root flowchart.
Matches the convention used by `FlowPauseEvent.subflowPath`,
`FlowchartCheckpoint.subflowPath`, etc.

***

#### timestamp

> `readonly` **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:104

Emission timestamp in milliseconds since epoch (`Date.now()`).


---


## Interface: ErrorEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:50

A recorder threw in a scope-channel hook (`operation` says which kind:
a read, a write, or a commit hook). Delivered to every recorder on the
scope channel, inline and deferred alike (`recorder/hooks.ts ·
recorderFailureEvent`).

### Extends

- `RecorderContext`

### Properties

#### channel?

> `optional` **channel?**: `"scope"`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:66

Explicit channel discriminant — `'scope'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-presence heuristic.

***

#### correlation?

> `readonly` `optional` **correlation?**: `RunCorrelation`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:22

The run's correlation (10.1) — the same frozen object as `TraversalContext.correlation` on the flow events
and `getSnapshot().correlation`. Absent — no key — when the run's env gave none.

##### Inherited from

`RecorderContext.correlation`

***

#### error

> **error**: `StructuredErrorInfo`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:57

What the recorder threw, in the structured form (9.39.0): `message` and
`name` read as before; `raw` is the thrown value itself (an `Error`, a
string, anything). One shape on every path — until 9.38.0 the inline
paths passed the raw thrown value and the deferred tier a `new Error(...)`.

***

#### key?

> `optional` **key?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:59

***

#### operation

> **operation**: `"read"` \| `"write"` \| `"commit"`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:58

***

#### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:16

##### Inherited from

`RecorderContext.pipelineId`

***

#### runtimeStageId

> **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

##### Inherited from

`RecorderContext.runtimeStageId`

***

#### stageId

> **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:13

Stable stage identifier (matches spec node id).

##### Inherited from

`RecorderContext.stageId`

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:11

##### Inherited from

`RecorderContext.stageName`

***

#### timestamp

> **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:17

##### Inherited from

`RecorderContext.timestamp`


---


## Interface: ReadEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:24

### Extends

- `RecorderContext`

### Properties

#### correlation?

> `readonly` `optional` **correlation?**: `RunCorrelation`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:22

The run's correlation (10.1) — the same frozen object as `TraversalContext.correlation` on the flow events
and `getSnapshot().correlation`. Absent — no key — when the run's env gave none.

##### Inherited from

`RecorderContext.correlation`

***

#### key?

> `optional` **key?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:25

***

#### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:16

##### Inherited from

`RecorderContext.pipelineId`

***

#### redacted?

> `optional` **redacted?**: `boolean`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:28

True when the value has been redacted for PII protection.

***

#### runtimeStageId

> **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

##### Inherited from

`RecorderContext.runtimeStageId`

***

#### stageId

> **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:13

Stable stage identifier (matches spec node id).

##### Inherited from

`RecorderContext.stageId`

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:11

##### Inherited from

`RecorderContext.stageName`

***

#### timestamp

> **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:17

##### Inherited from

`RecorderContext.timestamp`

***

#### value

> **value**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:26


---


## Interface: WriteEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:30

### Extends

- `RecorderContext`

### Properties

#### correlation?

> `readonly` `optional` **correlation?**: `RunCorrelation`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:22

The run's correlation (10.1) — the same frozen object as `TraversalContext.correlation` on the flow events
and `getSnapshot().correlation`. Absent — no key — when the run's env gave none.

##### Inherited from

`RecorderContext.correlation`

***

#### key

> **key**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:31

***

#### operation

> **operation**: `"set"` \| `"update"` \| `"delete"`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:33

***

#### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:16

##### Inherited from

`RecorderContext.pipelineId`

***

#### redacted?

> `optional` **redacted?**: `boolean`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:35

True when the value has been redacted for PII protection.

***

#### runtimeStageId

> **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

##### Inherited from

`RecorderContext.runtimeStageId`

***

#### stageId

> **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:13

Stable stage identifier (matches spec node id).

##### Inherited from

`RecorderContext.stageId`

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:11

##### Inherited from

`RecorderContext.stageName`

***

#### timestamp

> **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:17

##### Inherited from

`RecorderContext.timestamp`

***

#### value

> **value**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:32
