---
title: ScopeRecorder
---

# Interface: ScopeRecorder

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:114

Pluggable observer for scope operations.

All methods are optional — implement only the hooks you need.
Recorders are invoked synchronously in attachment order.
If a recorder throws, the error is caught and passed to onError
hooks of other recorders; the scope operation continues normally.

## Properties

### id

> `readonly` **id**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:115

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:134

Reset state before each executor.run() — prevents cross-run accumulation.

#### Returns

`void`

***

### onCommit()?

> `optional` **onCommit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:118

#### Parameters

##### event

[`CommitEvent`](/docs/api/interfaces/CommitEvent)

#### Returns

`void`

***

### onEmit()?

> `optional` **onEmit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:132

Fires for every `scope.$emit(name, payload)` call during a stage.
Optional — implement only if you want to observe consumer-emitted
structured events. See `EmitRecorder` for the focused interface
(structurally compatible; this field is the same shape).

#### Parameters

##### event

[`EmitEvent`](/docs/api/interfaces/EmitEvent)

#### Returns

`void`

#### See

EmitRecorder in `src/lib/recorder/EmitRecorder.ts`

***

### onError()?

> `optional` **onError**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:119

#### Parameters

##### event

[`ErrorEvent`](/docs/api/interfaces/ErrorEvent)

#### Returns

`void`

***

### onPause()?

> `optional` **onPause**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:122

#### Parameters

##### event

`PauseEvent`

#### Returns

`void`

***

### onRead()?

> `optional` **onRead**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:116

#### Parameters

##### event

[`ReadEvent`](/docs/api/interfaces/ReadEvent)

#### Returns

`void`

***

### onResume()?

> `optional` **onResume**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:123

#### Parameters

##### event

`ResumeEvent`

#### Returns

`void`

***

### onStageEnd()?

> `optional` **onStageEnd**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:121

#### Parameters

##### event

[`StageEvent`](/docs/api/interfaces/StageEvent)

#### Returns

`void`

***

### onStageStart()?

> `optional` **onStageStart**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:120

#### Parameters

##### event

[`StageEvent`](/docs/api/interfaces/StageEvent)

#### Returns

`void`

***

### onWrite()?

> `optional` **onWrite**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:117

#### Parameters

##### event

[`WriteEvent`](/docs/api/interfaces/WriteEvent)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:136

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
