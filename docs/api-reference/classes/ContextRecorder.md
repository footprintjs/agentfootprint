[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextRecorder

# Class: ContextRecorder

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:41](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L41)

## Implements

- `CombinedRecorder`

## Constructors

### Constructor

> **new ContextRecorder**(`options`): `ContextRecorder`

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:54](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L54)

#### Parameters

##### options

[`ContextRecorderOptions`](/agentfootprint/api/generated/interfaces/ContextRecorderOptions.md)

#### Returns

`ContextRecorder`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:42](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L42)

#### Implementation of

`CombinedRecorder.id`

## Methods

### onSubflowEntry()

> **onSubflowEntry**(`event`): `void`

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:62](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L62)

#### Parameters

##### event

`FlowSubflowEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onSubflowEntry`

***

### onSubflowExit()

> **onSubflowExit**(`event`): `void`

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L70)

#### Parameters

##### event

`FlowSubflowEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onSubflowExit`

***

### onWrite()

> **onWrite**(`event`): `void`

Defined in: [agentfootprint/src/recorders/core/ContextRecorder.ts:83](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/ContextRecorder.ts#L83)

#### Parameters

##### event

`WriteEvent`

#### Returns

`void`

#### Implementation of

`CombinedRecorder.onWrite`
