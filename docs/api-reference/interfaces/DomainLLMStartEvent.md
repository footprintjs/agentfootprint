[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainLLMStartEvent

# Interface: DomainLLMStartEvent

Defined in: [src/recorders/observability/BoundaryRecorder.ts:249](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L249)

## Extends

- `DomainEventBase`

## Properties

### actorArrow

> `readonly` **actorArrow**: `"user→llm"` \| `"tool→llm"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:258](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L258)

Capture-time classification: `'user→llm'` for the first call or any
 call not preceded by a tool result; `'tool→llm'` after a tool result.

***

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

### messagesCount?

> `readonly` `optional` **messagesCount?**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:254](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L254)

***

### model

> `readonly` **model**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:251](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L251)

***

### provider

> `readonly` **provider**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:252](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L252)

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

### systemPromptChars?

> `readonly` `optional` **systemPromptChars?**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:253](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L253)

***

### toolsCount?

> `readonly` `optional` **toolsCount?**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:255](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L255)

***

### ts

> `readonly` **ts**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:129](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L129)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"llm.start"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:250](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L250)
