[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ScopeRecorder

# Interface: ScopeRecorder

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:103

Pluggable observer for scope operations.

All methods are optional — implement only the hooks you need.
Recorders are invoked synchronously in attachment order.
If a recorder throws, the error is caught and passed to onError
hooks of other recorders; the scope operation continues normally.

## Properties

### id

> `readonly` **id**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:104

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:123

Reset state before each executor.run() — prevents cross-run accumulation.

#### Returns

`void`

***

### onCommit()?

> `optional` **onCommit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:107

#### Parameters

##### event

[`CommitEvent`](/agentfootprint/api/generated/interfaces/CommitEvent.md)

#### Returns

`void`

***

### onEmit()?

> `optional` **onEmit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:121

Fires for every `scope.$emit(name, payload)` call during a stage.
Optional — implement only if you want to observe consumer-emitted
structured events. See `EmitRecorder` for the focused interface
(structurally compatible; this field is the same shape).

#### Parameters

##### event

[`EmitEvent`](/agentfootprint/api/generated/interfaces/EmitEvent.md)

#### Returns

`void`

#### See

EmitRecorder in `src/lib/recorder/EmitRecorder.ts`

***

### onError()?

> `optional` **onError**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:108

#### Parameters

##### event

[`ErrorEvent`](/agentfootprint/api/generated/interfaces/ErrorEvent.md)

#### Returns

`void`

***

### onPause()?

> `optional` **onPause**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:111

#### Parameters

##### event

`PauseEvent`

#### Returns

`void`

***

### onRead()?

> `optional` **onRead**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:105

#### Parameters

##### event

[`ReadEvent`](/agentfootprint/api/generated/interfaces/ReadEvent.md)

#### Returns

`void`

***

### onResume()?

> `optional` **onResume**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:112

#### Parameters

##### event

`ResumeEvent`

#### Returns

`void`

***

### onStageEnd()?

> `optional` **onStageEnd**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:110

#### Parameters

##### event

[`StageEvent`](/agentfootprint/api/generated/interfaces/StageEvent.md)

#### Returns

`void`

***

### onStageStart()?

> `optional` **onStageStart**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:109

#### Parameters

##### event

[`StageEvent`](/agentfootprint/api/generated/interfaces/StageEvent.md)

#### Returns

`void`

***

### onWrite()?

> `optional` **onWrite**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:106

#### Parameters

##### event

[`WriteEvent`](/agentfootprint/api/generated/interfaces/WriteEvent.md)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:125

Expose collected data for inclusion in executor.getSnapshot().recorders.

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
