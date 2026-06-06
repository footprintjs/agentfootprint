[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EmitBridge

# Class: EmitBridge

Defined in: [src/recorders/core/EmitBridge.ts:27](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/core/EmitBridge.ts#L27)

## Implements

- [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

## Constructors

### Constructor

> **new EmitBridge**(`options`): `EmitBridge`

Defined in: [src/recorders/core/EmitBridge.ts:33](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/core/EmitBridge.ts#L33)

#### Parameters

##### options

[`EmitBridgeOptions`](/agentfootprint/api/generated/interfaces/EmitBridgeOptions.md)

#### Returns

`EmitBridge`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/recorders/core/EmitBridge.ts:28](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/core/EmitBridge.ts#L28)

#### Implementation of

`CombinedRecorder.id`

## Methods

### onEmit()

> **onEmit**(`event`): `void`

Defined in: [src/recorders/core/EmitBridge.ts:40](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/core/EmitBridge.ts#L40)

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

#### Implementation of

[`ScopeRecorder`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md).[`onEmit`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md#onemit)
