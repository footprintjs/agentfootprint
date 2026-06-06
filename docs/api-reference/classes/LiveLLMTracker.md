[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LiveLLMTracker

# Class: LiveLLMTracker

Defined in: [src/recorders/observability/LiveStateRecorder.ts:125](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L125)

Tracks the in-flight state of LLM calls. Subscribes to:
  - `agentfootprint.stream.llm_start`  → opens a boundary
  - `agentfootprint.stream.token`      → appends to partial
  - `agentfootprint.stream.llm_end`    → closes the boundary

Boundary key: `runtimeStageId` of the call-llm stage. Parallel LLM
calls (Parallel composition with multiple branches) get distinct
keys and are tracked independently.

## Constructors

### Constructor

> **new LiveLLMTracker**(): `LiveLLMTracker`

#### Returns

`LiveLLMTracker`

## Properties

### id

> `readonly` **id**: `"live-llm"` = `'live-llm'`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:126](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L126)

## Accessors

### activeCount

#### Get Signature

> **get** **activeCount**(): `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:200](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L200)

Number of currently-active boundaries.

##### Returns

`number`

***

### hasActive

#### Get Signature

> **get** **hasActive**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:195](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L195)

Same as `store.hasActive` — exposed for parity with the v4 API.

##### Returns

`boolean`

## Methods

### clear()

> **clear**(): `void`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:184](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L184)

Reset all transient state. Called by `LiveStateRecorder.clear()`.

#### Returns

`void`

***

### getActive()

> **getActive**(`runtimeStageId`): [`LLMLiveState`](/agentfootprint/api/generated/interfaces/LLMLiveState.md) \| `undefined`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:205](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L205)

Currently-active boundary state for one runtimeStageId.

#### Parameters

##### runtimeStageId

`string`

#### Returns

[`LLMLiveState`](/agentfootprint/api/generated/interfaces/LLMLiveState.md) \| `undefined`

***

### getAllActive()

> **getAllActive**(): `ReadonlyMap`\<`string`, [`LLMLiveState`](/agentfootprint/api/generated/interfaces/LLMLiveState.md)\>

Defined in: [src/recorders/observability/LiveStateRecorder.ts:210](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L210)

All currently-active boundaries.

#### Returns

`ReadonlyMap`\<`string`, [`LLMLiveState`](/agentfootprint/api/generated/interfaces/LLMLiveState.md)\>

***

### getLatestPartial()

> **getLatestPartial**(): `string`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:217](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L217)

Accumulated partial content of the MOST RECENTLY started active
 LLM call. Empty string when no call is active. Useful for the
 classic "Chatbot is responding: …" live commentary line.

#### Returns

`string`

***

### isInFlight()

> **isInFlight**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:190](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L190)

True if any LLM call is currently in flight.

#### Returns

`boolean`

***

### subscribe()

> **subscribe**(`runner`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:138](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L138)

Subscribe to a runner's dispatcher. Returns an Unsubscribe.

#### Parameters

##### runner

[`LiveStateRunnerLike`](/agentfootprint/api/generated/interfaces/LiveStateRunnerLike.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
