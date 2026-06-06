[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LiveAgentTurnTracker

# Class: LiveAgentTurnTracker

Defined in: [src/recorders/observability/LiveStateRecorder.ts:316](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L316)

Tracks in-flight agent turns. Subscribes to:
  - `agentfootprint.agent.turn_start` → opens a boundary
  - `agentfootprint.agent.turn_end`   → closes the boundary

Boundary key: stringified `turnIndex` from the payload — survives
across runner instances because turnIndex resets per-session.

## Constructors

### Constructor

> **new LiveAgentTurnTracker**(): `LiveAgentTurnTracker`

#### Returns

`LiveAgentTurnTracker`

## Properties

### id

> `readonly` **id**: `"live-agent-turn"` = `'live-agent-turn'`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:317](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L317)

## Accessors

### activeCount

#### Get Signature

> **get** **activeCount**(): `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:362](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L362)

##### Returns

`number`

***

### hasActive

#### Get Signature

> **get** **hasActive**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:358](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L358)

##### Returns

`boolean`

## Methods

### clear()

> **clear**(): `void`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:348](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L348)

#### Returns

`void`

***

### getActive()

> **getActive**(`turnIndex`): [`AgentTurnLiveState`](/agentfootprint/api/generated/interfaces/AgentTurnLiveState.md) \| `undefined`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:366](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L366)

#### Parameters

##### turnIndex

`string`

#### Returns

[`AgentTurnLiveState`](/agentfootprint/api/generated/interfaces/AgentTurnLiveState.md) \| `undefined`

***

### getAllActive()

> **getAllActive**(): `ReadonlyMap`\<`string`, [`AgentTurnLiveState`](/agentfootprint/api/generated/interfaces/AgentTurnLiveState.md)\>

Defined in: [src/recorders/observability/LiveStateRecorder.ts:370](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L370)

#### Returns

`ReadonlyMap`\<`string`, [`AgentTurnLiveState`](/agentfootprint/api/generated/interfaces/AgentTurnLiveState.md)\>

***

### getCurrentTurnIndex()

> **getCurrentTurnIndex**(): `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:375](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L375)

Index of the most-recently started active turn (-1 if none).

#### Returns

`number`

***

### isInTurn()

> **isInTurn**(): `boolean`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:354](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L354)

True if the agent is currently inside a turn.

#### Returns

`boolean`

***

### subscribe()

> **subscribe**(`runner`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:326](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L326)

#### Parameters

##### runner

[`LiveStateRunnerLike`](/agentfootprint/api/generated/interfaces/LiveStateRunnerLike.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
