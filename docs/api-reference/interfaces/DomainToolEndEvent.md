[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainToolEndEvent

# Interface: DomainToolEndEvent

Defined in: [src/recorders/observability/BoundaryRecorder.ts:279](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L279)

## Extends

- `DomainEventBase`

## Properties

### commitIdxAfter

> `readonly` **commitIdxAfter**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:146](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L146)

RESERVED for future event types that trigger engine writes.
 CURRENT BEHAVIOR: always equals `commitIdxBefore` for every event
 emitted by today's BoundaryRecorder. Observer events don't write
 to scope, so the executor's commit count doesn't change between
 the moment the event is sampled and the moment it's recorded.
 Consumers should currently treat this as identical to
 `commitIdxBefore`; do NOT rely on it being strictly greater.
 The field exists for forward compatibility — if a future
 observer pattern triggers commits during its handler, this is
 where the post-effect count will land.

#### Inherited from

`DomainEventBase.commitIdxAfter`

***

### commitIdxBefore

> `readonly` **commitIdxBefore**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:135](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L135)

Commit count when this event fired. 0 if the recorder was
 constructed without `getCommitCount` (legacy mode). The boundary
 RANGE for an (entry, exit) pair is `[entry.commitIdxBefore,
 exit.commitIdxBefore]`. Phase 5 Layer 2 — see
 `docs/design/boundary-commit-ranges.md`.

#### Inherited from

`DomainEventBase.commitIdxBefore`

***

### depth

> `readonly` **depth**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:127](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L127)

Depth in the run tree — root = 0, top-level subflow = 1, etc.

#### Inherited from

`DomainEventBase.depth`

***

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:283](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L283)

***

### error?

> `readonly` `optional` **error?**: `boolean`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:284](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L284)

***

### result?

> `readonly` `optional` **result?**: `unknown`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:282](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L282)

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:123](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L123)

Stable per-execution key (footprintjs primitive). For run events it
 is `'__root__#0'`; subflow events use the parent stage's runtimeStageId
 at mount; typed events use the firing stage's runtimeStageId.

#### Inherited from

`DomainEventBase.runtimeStageId`

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:125](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L125)

Decomposition of `subflowId` into segments, rooted under `'__root__'`.

#### Inherited from

`DomainEventBase.subflowPath`

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:281](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L281)

***

### ts

> `readonly` **ts**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:129](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L129)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"tool.end"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:280](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L280)
