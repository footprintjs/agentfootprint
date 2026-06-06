[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BoundaryRangeLabel

# Interface: BoundaryRangeLabel

Defined in: [src/recorders/observability/BoundaryRecorder.ts:438](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L438)

Stripped projection used as the LABEL for the commit-range index.
Intentionally OMITS `payload` (security panel review YELLOW #1):
`boundaryIndex.enclosing()` queries should not bypass redaction by
exposing raw scope payloads through the range index. Consumers
needing payload can join on `runtimeStageId` with the full event
stream via `getEvents()` (which IS subject to redaction policy).

## Properties

### compositionKind?

> `readonly` `optional` **compositionKind?**: `"Sequence"` \| `"Parallel"` \| `"Conditional"` \| `"Loop"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:454](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L454)

Composition primitive (Parallel/Sequence/Loop/Conditional) when the
 range was opened by a `composition.start` event.

***

### compositionName?

> `readonly` `optional` **compositionName?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:455](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L455)

***

### depth

> `readonly` **depth**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:442](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L442)

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:448](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L448)

***

### isAgentInternal?

> `readonly` `optional` **isAgentInternal?**: `boolean`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:451](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L451)

***

### localSubflowId?

> `readonly` `optional` **localSubflowId?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:446](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L446)

***

### primitiveKind?

> `readonly` `optional` **primitiveKind?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:449](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L449)

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:440](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L440)

***

### slotKind?

> `readonly` `optional` **slotKind?**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [src/recorders/observability/BoundaryRecorder.ts:450](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L450)

***

### subflowId?

> `readonly` `optional` **subflowId?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:445](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L445)

Set on subflow entries; undefined on the synthetic run-root entry.

***

### subflowName?

> `readonly` `optional` **subflowName?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:447](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L447)

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [src/recorders/observability/BoundaryRecorder.ts:441](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L441)

***

### ts

> `readonly` **ts**: `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:443](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L443)

***

### type

> `readonly` **type**: `"run.entry"` \| `"subflow.entry"` \| `"composition.start"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:439](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L439)
