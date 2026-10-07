---
title: ErrorEvent
---

# Interface: ErrorEvent

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:44

A recorder threw in a scope-channel hook (`operation` says which kind:
a read, a write, or a commit hook). Delivered to every recorder on the
scope channel, inline and deferred alike (`recorder/hooks.ts ·
recorderFailureEvent`).

## Extends

- `RecorderContext`

## Properties

### channel?

> `optional` **channel?**: `"scope"`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:60

Explicit channel discriminant — `'scope'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-presence heuristic.

***

### error

> **error**: `StructuredErrorInfo`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:51

What the recorder threw, in the structured form (9.39.0): `message` and
`name` read as before; `raw` is the thrown value itself (an `Error`, a
string, anything). One shape on every path — until 9.38.0 the inline
paths passed the raw thrown value and the deferred tier a `new Error(...)`.

***

### key?

> `optional` **key?**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:53

***

### operation

> **operation**: `"read"` \| `"write"` \| `"commit"`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:52

***

### pipelineId

> **pipelineId**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

#### Inherited from

`RecorderContext.pipelineId`

***

### runtimeStageId

> **runtimeStageId**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:14

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

#### Inherited from

`RecorderContext.runtimeStageId`

***

### stageId

> **stageId**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:12

Stable stage identifier (matches spec node id).

#### Inherited from

`RecorderContext.stageId`

***

### stageName

> **stageName**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:10

#### Inherited from

`RecorderContext.stageName`

***

### timestamp

> **timestamp**: `number`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:16

#### Inherited from

`RecorderContext.timestamp`
