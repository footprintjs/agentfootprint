[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainLLMStartEvent

# Interface: DomainLLMStartEvent

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:190](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L190)

## Extends

- `DomainEventBase`

## Properties

### actorArrow

> `readonly` **actorArrow**: `"user→llm"` \| `"tool→llm"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:199](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L199)

Capture-time classification: `'user→llm'` for the first call or any
 call not preceded by a tool result; `'tool→llm'` after a tool result.

***

### depth

> `readonly` **depth**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L113)

Depth in the run tree — root = 0, top-level subflow = 1, etc.

#### Inherited from

`DomainEventBase.depth`

***

### messagesCount?

> `readonly` `optional` **messagesCount?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:195](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L195)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:192](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L192)

***

### provider

> `readonly` **provider**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:193](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L193)

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

### systemPromptChars?

> `readonly` `optional` **systemPromptChars?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:194](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L194)

***

### toolsCount?

> `readonly` `optional` **toolsCount?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:196](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L196)

***

### ts

> `readonly` **ts**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:115](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L115)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"llm.start"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:191](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L191)
