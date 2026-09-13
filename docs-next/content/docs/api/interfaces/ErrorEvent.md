---
title: ErrorEvent
---

# Interface: ErrorEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:37

## Extends

- `RecorderContext`

## Properties

### channel?

> `optional` **channel?**: `"scope"`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:47

Explicit channel discriminant — `'scope'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-presence heuristic.

***

### error

> **error**: `Error`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:38

***

### key?

> `optional` **key?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:40

***

### operation

> **operation**: `"read"` \| `"write"` \| `"commit"`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:39

***

### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:14

#### Inherited from

`RecorderContext.pipelineId`

***

### runtimeStageId

> **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:13

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

#### Inherited from

`RecorderContext.runtimeStageId`

***

### stageId

> **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:11

Stable stage identifier (matches spec node id).

#### Inherited from

`RecorderContext.stageId`

***

### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:9

#### Inherited from

`RecorderContext.stageName`

***

### timestamp

> **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

#### Inherited from

`RecorderContext.timestamp`
