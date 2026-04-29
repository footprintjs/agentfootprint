[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainLLMEndEvent

# Interface: DomainLLMEndEvent

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:202](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L202)

## Extends

- `DomainEventBase`

## Properties

### actorArrow

> `readonly` **actorArrow**: `"llm→tool"` \| `"llm→user"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:210](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L210)

Capture-time classification: `'llm→tool'` when the LLM requested
 tools (`toolCallCount > 0`); `'llm→user'` for terminal delivery.

***

### content

> `readonly` **content**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:204](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L204)

***

### depth

> `readonly` **depth**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L113)

Depth in the run tree — root = 0, top-level subflow = 1, etc.

#### Inherited from

`DomainEventBase.depth`

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

### stopReason?

> `readonly` `optional` **stopReason?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:207](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L207)

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:111](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L111)

Decomposition of `subflowId` into segments, rooted under `'__root__'`.

#### Inherited from

`DomainEventBase.subflowPath`

***

### toolCallCount

> `readonly` **toolCallCount**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:205](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L205)

***

### ts

> `readonly` **ts**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:115](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L115)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"llm.end"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:203](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L203)

***

### usage

> `readonly` **usage**: `object`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:206](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L206)

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`
