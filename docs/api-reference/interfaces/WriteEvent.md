[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WriteEvent

# Interface: WriteEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:23

## Extends

- `RecorderContext`

## Properties

### key

> **key**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:24

***

### operation

> **operation**: `"set"` \| `"update"` \| `"delete"`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:26

***

### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:14

#### Inherited from

`RecorderContext.pipelineId`

***

### redacted?

> `optional` **redacted?**: `boolean`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:28

True when the value has been redacted for PII protection.

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

***

### value

> **value**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:25
