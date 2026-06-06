[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LiveToolTracker

# Class: LiveToolTracker

Defined in: [src/recorders/observability/LiveStateRecorder.ts:241](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L241)

Tracks in-flight tool calls. Subscribes to:
  - `agentfootprint.stream.tool_start` → opens a boundary
  - `agentfootprint.stream.tool_end`   → closes the boundary

Boundary key: `toolCallId` (more granular than `runtimeStageId` —
parallel tools share one calling stage but have distinct toolCallIds).

## Constructors

### Constructor

> **new LiveToolTracker**(): `LiveToolTracker`

#### Returns

`LiveToolTracker`

## Properties

### id

> `readonly` **id**: `"live-tool"` = `'live-tool'`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:242](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L242)

## Accessors

### activeCount

#### Get Signature

> **get** **activeCount**(): `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:288](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L288)

##### Returns

`number`

***

### hasActive

#### Get Signature

> **get** **hasActive**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:284](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L284)

##### Returns

`boolean`

## Methods

### clear()

> **clear**(): `void`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:274](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L274)

#### Returns

`void`

***

### getActive()

> **getActive**(`toolCallId`): [`ToolLiveState`](/agentfootprint/api/generated/interfaces/ToolLiveState.md) \| `undefined`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:292](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L292)

#### Parameters

##### toolCallId

`string`

#### Returns

[`ToolLiveState`](/agentfootprint/api/generated/interfaces/ToolLiveState.md) \| `undefined`

***

### getAllActive()

> **getAllActive**(): `ReadonlyMap`\<`string`, [`ToolLiveState`](/agentfootprint/api/generated/interfaces/ToolLiveState.md)\>

Defined in: [src/recorders/observability/LiveStateRecorder.ts:296](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L296)

#### Returns

`ReadonlyMap`\<`string`, [`ToolLiveState`](/agentfootprint/api/generated/interfaces/ToolLiveState.md)\>

***

### getExecutingToolNames()

> **getExecutingToolNames**(): readonly `string`[]

Defined in: [src/recorders/observability/LiveStateRecorder.ts:301](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L301)

Names of tools currently executing. Empty when none.

#### Returns

readonly `string`[]

***

### isExecuting()

> **isExecuting**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:280](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L280)

True if any tool is currently executing.

#### Returns

`boolean`

***

### subscribe()

> **subscribe**(`runner`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:251](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L251)

#### Parameters

##### runner

[`LiveStateRunnerLike`](/agentfootprint/api/generated/interfaces/LiveStateRunnerLike.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
