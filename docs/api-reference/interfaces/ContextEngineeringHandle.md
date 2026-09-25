[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextEngineeringHandle

# Interface: ContextEngineeringHandle

Defined in: [src/recorders/core/contextEngineering.ts:138](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/recorders/core/contextEngineering.ts#L138)

Handle returned by `contextEngineering(agent)`. Lets consumers
subscribe to engineered / baseline streams and detach cleanly.

## Methods

### detach()

> **detach**(): `void`

Defined in: [src/recorders/core/contextEngineering.ts:154](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/recorders/core/contextEngineering.ts#L154)

Detach all subscriptions registered through this handle. After
calling, no further callbacks will fire. Idempotent (safe to
call multiple times).

#### Returns

`void`

***

### onBaseline()

> **onBaseline**(`listener`): [`ContextEngineeringUnsubscribe`](/agentfootprint/api/generated/type-aliases/ContextEngineeringUnsubscribe.md)

Defined in: [src/recorders/core/contextEngineering.ts:148](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/recorders/core/contextEngineering.ts#L148)

Fires for `context.injected` events whose source is in
`BASELINE_SOURCES`. Returns an unsubscribe function.

#### Parameters

##### listener

[`ContextInjectedListener`](/agentfootprint/api/generated/type-aliases/ContextInjectedListener.md)

#### Returns

[`ContextEngineeringUnsubscribe`](/agentfootprint/api/generated/type-aliases/ContextEngineeringUnsubscribe.md)

***

### onEngineered()

> **onEngineered**(`listener`): [`ContextEngineeringUnsubscribe`](/agentfootprint/api/generated/type-aliases/ContextEngineeringUnsubscribe.md)

Defined in: [src/recorders/core/contextEngineering.ts:143](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/recorders/core/contextEngineering.ts#L143)

Fires for `context.injected` events whose source is in
`ENGINEERED_SOURCES`. Returns an unsubscribe function.

#### Parameters

##### listener

[`ContextInjectedListener`](/agentfootprint/api/generated/type-aliases/ContextInjectedListener.md)

#### Returns

[`ContextEngineeringUnsubscribe`](/agentfootprint/api/generated/type-aliases/ContextEngineeringUnsubscribe.md)
