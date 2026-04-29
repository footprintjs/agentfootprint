[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainSubflowEvent

# Interface: DomainSubflowEvent

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:125](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L125)

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

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:133](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L133)

Build-time description from the subflow root (`'<Kind>: <detail>'`).

***

### isAgentInternal

> `readonly` **isAgentInternal**: `boolean`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:139](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L139)

True for Agent state-machine routing/wrapper subflows (route, tool-calls, final, merge).

***

### localSubflowId

> `readonly` **localSubflowId**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:130](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L130)

Last segment of `subflowId` — convenience for leaf-name grouping.

***

### payload?

> `readonly` `optional` **payload?**: `unknown`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:141](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L141)

`inputMapper` result on entry; subflow shared state on exit.

***

### primitiveKind?

> `readonly` `optional` **primitiveKind?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:135](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L135)

Parsed `'<Kind>:'` prefix — `'Agent'`, `'LLMCall'`, `'Sequence'`, etc.

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

### slotKind?

> `readonly` `optional` **slotKind?**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:137](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L137)

Set ONLY for the 3 input-slot subflows (sf-system-prompt / sf-messages / sf-tools).

***

### subflowId

> `readonly` **subflowId**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:128](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L128)

Path-prefixed engine id (matches `FlowSubflowEvent.subflowId`).

***

### subflowName

> `readonly` **subflowName**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:131](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L131)

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:111](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L111)

Decomposition of `subflowId` into segments, rooted under `'__root__'`.

#### Inherited from

`DomainEventBase.subflowPath`

***

### ts

> `readonly` **ts**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:115](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L115)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"subflow.entry"` \| `"subflow.exit"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:126](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L126)
