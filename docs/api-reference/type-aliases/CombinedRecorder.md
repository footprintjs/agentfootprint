[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CombinedRecorder

# Type Alias: CombinedRecorder

> **CombinedRecorder** = `Partial`\<`Omit`\<[`ScopeRecorder`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md), `SharedLifecycleOverlap` \| `SharedLifecycle`\>\> & `Partial`\<`Omit`\<[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md), `SharedLifecycleOverlap` \| `SharedLifecycle`\>\> & `Partial`\<`Omit`\<[`EmitRecorder`](/agentfootprint/api/generated/interfaces/EmitRecorder.md), `SharedLifecycle`\>\> & `object`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/CombinedRecorder.d.ts:93

A recorder that MAY observe any combination of supported event streams.

Today's streams:
  - Scope data-flow (`ScopeRecorder`: onRead/onWrite/onCommit/onStageStart/…)
  - Control-flow (`FlowRecorder`: onDecision/onSubflowEntry/onLoop/…)

All event handlers are optional — implement only what you care about.
`id` is required so the library can deduplicate re-attaches.

## Shared method names (onError / onPause / onResume)

Both `ScopeRecorder` and `FlowRecorder` declare these with DIFFERENT payload
shapes. In a combined recorder, each such handler is called by BOTH
channels with its own variant. The parameter type is a union — consumers
can either handle both variants uniformly, or discriminate (control-flow
variants carry a `traversalContext` field that data-flow variants lack).

## Forward compatibility

When a third observer type ships (e.g. `OperationRecorder`), the type
gains another `& Partial<…>` clause. Because every clause is `Partial`,
existing `CombinedRecorder` implementations remain type-valid.

## Type Declaration

### clear()?

> `optional` **clear**(): `void`

#### Returns

`void`

### id

> `readonly` **id**: `string`

### onError()?

> `optional` **onError**(`event`): `void`

#### Parameters

##### event

[`ErrorEvent`](/agentfootprint/api/generated/interfaces/ErrorEvent.md) \| [`FlowErrorEvent`](/agentfootprint/api/generated/interfaces/FlowErrorEvent.md)

#### Returns

`void`

### onPause()?

> `optional` **onPause**(`event`): `void`

#### Parameters

##### event

`PauseEvent` \| `FlowPauseEvent`

#### Returns

`void`

### onResume()?

> `optional` **onResume**(`event`): `void`

#### Parameters

##### event

`ResumeEvent` \| `FlowResumeEvent`

#### Returns

`void`

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

#### Returns

`object`

##### data

> **data**: `unknown`

##### description?

> `optional` **description?**: `string`

##### name

> **name**: `string`

##### preferredOperation?

> `optional` **preferredOperation?**: `"translate"` \| `"accumulate"` \| `"aggregate"`
