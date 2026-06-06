[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunStep

# Interface: RunStep

Defined in: [src/recorders/observability/RunStepRecorder.ts:71](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L71)

One slider position. The smallest scrubable unit of the run.

`transitions` is 1+ — fan-out / merge steps light up multiple
transitions at once; sequential / decide / react steps light up
exactly one. Renderers iterate `transitions` to highlight edges;
details panels read `anchor.runtimeStageId`.

## Properties

### anchor

> `readonly` **anchor**: `object`

Defined in: [src/recorders/observability/RunStepRecorder.ts:84](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L84)

Anchor for commentary highlight + details pane lookup.

#### runtimeStageId

> `readonly` **runtimeStageId**: `string`

#### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

***

### kind

> `readonly` **kind**: [`RunStepKind`](/agentfootprint/api/generated/type-aliases/RunStepKind.md)

Defined in: [src/recorders/observability/RunStepRecorder.ts:74](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L74)

***

### label

> `readonly` **label**: `string`

Defined in: [src/recorders/observability/RunStepRecorder.ts:89](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L89)

Human label — short, kind-specific.

***

### meta?

> `readonly` `optional` **meta?**: [`RunStepMeta`](/agentfootprint/api/generated/type-aliases/RunStepMeta.md)

Defined in: [src/recorders/observability/RunStepRecorder.ts:93](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L93)

Kind-specific decoration. Discriminate on `kind`.

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [src/recorders/observability/RunStepRecorder.ts:82](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L82)

Per-step key — required by `SequenceStore<T>` for time-travel
utilities (`getEntriesForStep`, `getEntryRanges`). Mirrors
`anchor.runtimeStageId`; both fields point at the same value.
Top-level placement satisfies the recorder's storage contract.

***

### seq

> `readonly` **seq**: `number`

Defined in: [src/recorders/observability/RunStepRecorder.ts:73](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L73)

0-based slider index (matches array position in `getSteps()`).

***

### transitions

> `readonly` **transitions**: readonly [`RunStepTransition`](/agentfootprint/api/generated/interfaces/RunStepTransition.md)[]

Defined in: [src/recorders/observability/RunStepRecorder.ts:75](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L75)

***

### tsMs

> `readonly` **tsMs**: `number`

Defined in: [src/recorders/observability/RunStepRecorder.ts:91](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L91)

Wall-clock ms at which this step occurred.
