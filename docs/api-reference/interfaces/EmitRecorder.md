[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmitRecorder

# Interface: EmitRecorder

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:112

Pluggable observer for consumer-emitted structured events.

All methods are optional; implement only what you care about. Recorders
are invoked synchronously in attachment order. If a recorder throws, the
error is caught and isolated — other recorders continue to receive the
event and the emitting stage is unaffected.

## Properties

### id

> `readonly` **id**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:117

Stable identifier for idempotent attach/detach. Re-attaching with the
same id replaces the previous registration on the executor.

## Methods

### clear()?

> `optional` **clear**(): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:124

Optional: reset recorder-internal state between runs. Called by the
executor before each `run()`.

#### Returns

`void`

***

### onEmit()?

> `optional` **onEmit**(`event`): `void`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:119

Called for every `scope.$emit(name, payload)` call in any stage.

#### Parameters

##### event

[`EmitEvent`](/agentfootprint/api/generated/interfaces/EmitEvent.md)

#### Returns

`void`

***

### toSnapshot()?

> `optional` **toSnapshot**(): `object`

Defined in: node\_modules/footprintjs/dist/types/lib/recorder/EmitRecorder.d.ts:129

Optional: expose collected data for inclusion in
`executor.getSnapshot().recorders`.

#### Returns

`object`

##### data

> **data**: `unknown`

##### description?

> `optional` **description?**: `string`

##### name

> **name**: `string`

##### preferredOperation?

> `optional` **preferredOperation?**: `RecorderOperation`
