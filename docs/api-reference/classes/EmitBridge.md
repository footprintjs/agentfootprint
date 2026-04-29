[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmitBridge

# Class: EmitBridge

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:27](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L27)

## Implements

- `CombinedRecorder`

## Constructors

### Constructor

> **new EmitBridge**(`options`): `EmitBridge`

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:33](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L33)

#### Parameters

##### options

[`EmitBridgeOptions`](/agentfootprint/api/generated/interfaces/EmitBridgeOptions.md)

#### Returns

`EmitBridge`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L28)

#### Implementation of

`CombinedRecorder.id`

## Methods

### onEmit()

> **onEmit**(`event`): `void`

Defined in: [agentfootprint/src/recorders/core/EmitBridge.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/EmitBridge.ts#L40)

Fires for every `scope.$emit(name, payload)` call during a stage.
Optional — implement only if you want to observe consumer-emitted
structured events. See `EmitRecorder` for the focused interface
(structurally compatible; this field is the same shape).

#### Parameters

##### event

`EmitEvent`

#### Returns

`void`

#### See

EmitRecorder in `src/lib/recorder/EmitRecorder.ts`

#### Implementation of

`CombinedRecorder.onEmit`
