[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainContextInjectedEvent

# Interface: DomainContextInjectedEvent

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:228](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L228)

## Extends

- `DomainEventBase`

## Properties

### asRole?

> `readonly` `optional` **asRole?**: `"system"` \| `"user"` \| `"assistant"` \| `"tool"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:233](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L233)

***

### budgetFraction?

> `readonly` `optional` **budgetFraction?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:243](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L243)

Fraction of slot cap consumed (from `budgetSpent.fractionOfCap`).

***

### budgetTokens?

> `readonly` `optional` **budgetTokens?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:241](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L241)

Tokens consumed by this injection (from `budgetSpent.tokens`).

***

### contentSummary?

> `readonly` `optional` **contentSummary?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:234](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L234)

***

### depth

> `readonly` **depth**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:113](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L113)

Depth in the run tree — root = 0, top-level subflow = 1, etc.

#### Inherited from

`DomainEventBase.depth`

***

### rankPosition?

> `readonly` `optional` **rankPosition?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:239](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L239)

***

### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:235](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L235)

***

### retrievalScore?

> `readonly` `optional` **retrievalScore?**: `number`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:238](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L238)

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

### sectionTag?

> `readonly` `optional` **sectionTag?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:236](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L236)

***

### slot

> `readonly` **slot**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:230](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L230)

***

### source

> `readonly` **source**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:231](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L231)

***

### sourceId?

> `readonly` `optional` **sourceId?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:232](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L232)

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

> `readonly` **type**: `"context.injected"`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:229](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L229)

***

### upstreamRef?

> `readonly` `optional` **upstreamRef?**: `string`

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:237](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L237)
