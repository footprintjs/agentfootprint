[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainSubflowEvent

# Interface: DomainSubflowEvent

Defined in: [src/recorders/observability/BoundaryRecorder.ts:156](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L156)

## Extends

- `DomainEventBase`

## Properties

### commitIdxAfter

> `readonly` **commitIdxAfter**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:146](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L146)

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

Defined in: [src/recorders/observability/BoundaryRecorder.ts:135](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L135)

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

Defined in: [src/recorders/observability/BoundaryRecorder.ts:127](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L127)

Depth in the run tree — root = 0, top-level subflow = 1, etc.

#### Inherited from

`DomainEventBase.depth`

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:164](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L164)

Build-time description from the subflow root (`'<Kind>: <detail>'`).

***

### isAgentInternal

> `readonly` **isAgentInternal**: `boolean`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:170](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L170)

True for Agent state-machine routing/wrapper subflows (route, tool-calls, final, merge).

***

### localSubflowId

> `readonly` **localSubflowId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:161](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L161)

Last segment of `subflowId` — convenience for leaf-name grouping.

***

### payload?

> `readonly` `optional` **payload?**: `unknown`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:172](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L172)

`inputMapper` result on entry; subflow shared state on exit.

***

### primitiveKind?

> `readonly` `optional` **primitiveKind?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:166](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L166)

Parsed `'<Kind>:'` prefix — `'Agent'`, `'LLMCall'`, `'Sequence'`, etc.

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:123](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L123)

Stable per-execution key (footprintjs primitive). For run events it
 is `'__root__#0'`; subflow events use the parent stage's runtimeStageId
 at mount; typed events use the firing stage's runtimeStageId.

#### Inherited from

`DomainEventBase.runtimeStageId`

***

### slotKind?

> `readonly` `optional` **slotKind?**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [src/recorders/observability/BoundaryRecorder.ts:168](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L168)

Set ONLY for the 3 input-slot subflows (sf-system-prompt / sf-messages / sf-tools).

***

### subflowId

> `readonly` **subflowId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:159](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L159)

Path-prefixed engine id (matches `FlowSubflowEvent.subflowId`).

***

### subflowName

> `readonly` **subflowName**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:162](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L162)

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:125](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L125)

Decomposition of `subflowId` into segments, rooted under `'__root__'`.

#### Inherited from

`DomainEventBase.subflowPath`

***

### ts

> `readonly` **ts**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:129](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L129)

Wall-clock ms at capture time.

#### Inherited from

`DomainEventBase.ts`

***

### type

> `readonly` **type**: `"subflow.entry"` \| `"subflow.exit"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:157](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L157)
