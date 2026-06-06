[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CommitEvent

# Interface: CommitEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:30

## Extends

- `RecorderContext`

## Properties

### mutations

> **mutations**: `object`[]

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:31

#### key

> **key**: `string`

#### operation

> **operation**: `"set"` \| `"update"` \| `"delete"`

#### value

> **value**: `unknown`

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
