---
title: ScopeRecorder
---

# Interface: ScopeRecorder

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:91

Pluggable observer for scope operations.

All methods are optional — implement only the hooks you need.
Recorders are invoked synchronously in attachment order.
If a recorder throws, the error is caught and passed to onError
hooks of other recorders; the scope operation continues normally.

## Properties

### id

> `readonly` **id**: `string`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:92

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:111

Reset state before each executor.run() — prevents cross-run accumulation.

#### Returns

`void`

***

### onCommit()?

> `optional` **onCommit**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:95

#### Parameters

##### event

[`CommitEvent`](/docs/api/interfaces/CommitEvent)

#### Returns

`void`

***

### onEmit()?

> `optional` **onEmit**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:109

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

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:96

#### Parameters

##### event

[`ErrorEvent`](/docs/api/interfaces/ErrorEvent)

#### Returns

`void`

***

### onPause()?

> `optional` **onPause**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:99

#### Parameters

##### event

`PauseEvent`

#### Returns

`void`

***

### onRead()?

> `optional` **onRead**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:93

#### Parameters

##### event

[`ReadEvent`](/docs/api/interfaces/ReadEvent)

#### Returns

`void`

***

### onResume()?

> `optional` **onResume**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:100

#### Parameters

##### event

`ResumeEvent`

#### Returns

`void`

***

### onStageEnd()?

> `optional` **onStageEnd**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:98

#### Parameters

##### event

[`StageEvent`](/docs/api/interfaces/StageEvent)

#### Returns

`void`

***

### onStageStart()?

> `optional` **onStageStart**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:97

#### Parameters

##### event

[`StageEvent`](/docs/api/interfaces/StageEvent)

#### Returns

`void`

***

### onWrite()?

> `optional` **onWrite**(`event`): `void`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:94

#### Parameters

##### event

[`WriteEvent`](/docs/api/interfaces/WriteEvent)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `RecorderBundle`

Defined in: ../../../../../../../Users/sanjay/github/footprintjs/af-wt-redaction/node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:113

Expose collected data for inclusion in executor.getSnapshot().recorders.

#### Returns

`RecorderBundle`
