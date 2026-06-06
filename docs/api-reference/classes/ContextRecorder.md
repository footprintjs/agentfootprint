[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextRecorder

# Class: ContextRecorder

Defined in: [src/recorders/core/ContextRecorder.ts:41](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L41)

## Implements

- [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

## Constructors

### Constructor

> **new ContextRecorder**(`options`): `ContextRecorder`

Defined in: [src/recorders/core/ContextRecorder.ts:57](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L57)

#### Parameters

##### options

[`ContextRecorderOptions`](/agentfootprint/api/generated/interfaces/ContextRecorderOptions.md)

#### Returns

`ContextRecorder`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/recorders/core/ContextRecorder.ts:42](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L42)

#### Implementation of

`CombinedRecorder.id`

## Methods

### onSubflowEntry()

> **onSubflowEntry**(`event`): `void`

Defined in: [src/recorders/core/ContextRecorder.ts:65](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L65)

#### Parameters

##### event

[`FlowSubflowEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onSubflowEntry`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onsubflowentry)

***

### onSubflowExit()

> **onSubflowExit**(`event`): `void`

Defined in: [src/recorders/core/ContextRecorder.ts:73](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L73)

#### Parameters

##### event

[`FlowSubflowEvent`](/agentfootprint/api/generated/interfaces/FlowSubflowEvent.md)

#### Returns

`void`

#### Implementation of

[`FlowRecorder`](/agentfootprint/api/generated/interfaces/FlowRecorder.md).[`onSubflowExit`](/agentfootprint/api/generated/interfaces/FlowRecorder.md#onsubflowexit)

***

### onWrite()

> **onWrite**(`event`): `void`

Defined in: [src/recorders/core/ContextRecorder.ts:82](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/ContextRecorder.ts#L82)

#### Parameters

##### event

[`WriteEvent`](/agentfootprint/api/generated/interfaces/WriteEvent.md)

#### Returns

`void`

#### Implementation of

[`ScopeRecorder`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md).[`onWrite`](/agentfootprint/api/generated/interfaces/ScopeRecorder.md#onwrite)
