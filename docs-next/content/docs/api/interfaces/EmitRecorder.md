---
title: EmitRecorder
---

# Interface: EmitRecorder

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:121

Pluggable observer for consumer-emitted structured events.

All methods are optional; implement only what you care about. Recorders
are invoked synchronously in attachment order. If a recorder throws, the
error is caught and isolated — other recorders continue to receive the
event and the emitting stage is unaffected.

## Properties

### id

> `readonly` **id**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:126

Stable identifier for idempotent attach/detach. Re-attaching with the
same id replaces the previous registration on the executor.

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:133

Optional: reset recorder-internal state between runs. Called by the
executor before each `run()`.

#### Returns

`void`

***

### onEmit()?

> `optional` **onEmit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:128

Called for every `scope.$emit(name, payload)` call in any stage.

#### Parameters

##### event

[`EmitEvent`](/docs/api/interfaces/EmitEvent)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `RecorderBundle`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:138

Optional: expose collected data for inclusion in
`executor.getSnapshot().recorders`.

#### Returns

`RecorderBundle`
