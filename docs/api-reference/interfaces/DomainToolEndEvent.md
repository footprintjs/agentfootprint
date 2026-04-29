[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainToolEndEvent

# Interface: DomainToolEndEvent

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:220](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L220)

## Extends

- `DomainEventBase`

## Properties

### depth

> `readonly` **depth**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L113)

Depth in the run tree — root = 0, top-level subflow = 1, etc.

#### Inherited from

`DomainEventBase.depth`

***

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:224](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L224)

***

### error?

> `readonly` `optional` **error?**: `boolean`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:225](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L225)

***

### result?

> `readonly` `optional` **result?**: `unknown`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:223](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L223)

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:109](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L109)

Stable per-execution key (footprintjs primitive). For run events it
 is `'__root__#0'`; subflow events use the parent stage's runtimeStageId
 at mount; typed events use the firing stage's runtimeStageId.

#### Inherited from

`DomainEventBase.runtimeStageId`

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:111](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L111)

Decomposition of `subflowId` into segments, rooted under `'__root__'`.

#### Inherited from

`DomainEventBase.subflowPath`

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:222](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L222)

***

### ts

> `readonly` **ts**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:115](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L115)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"tool.end"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:221](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L221)
