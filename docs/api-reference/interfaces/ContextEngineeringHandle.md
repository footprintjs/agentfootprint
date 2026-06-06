[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextEngineeringHandle

# Interface: ContextEngineeringHandle

Defined in: [src/recorders/core/contextEngineering.ts:137](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/core/contextEngineering.ts#L137)

Handle returned by `contextEngineering(agent)`. Lets consumers
subscribe to engineered / baseline streams and detach cleanly.

## Methods

### detach()

> **detach**(): `void`

Defined in: [src/recorders/core/contextEngineering.ts:153](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/core/contextEngineering.ts#L153)

Detach all subscriptions registered through this handle. After
calling, no further callbacks will fire. Idempotent (safe to
call multiple times).

#### Returns

`void`

***

### onBaseline()

> **onBaseline**(`listener`): [`ContextEngineeringUnsubscribe`](/agentfootprint/api/generated/type-aliases/ContextEngineeringUnsubscribe.md)

Defined in: [src/recorders/core/contextEngineering.ts:147](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/core/contextEngineering.ts#L147)

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

Defined in: [src/recorders/core/contextEngineering.ts:142](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/core/contextEngineering.ts#L142)

Fires for `context.injected` events whose source is in
`ENGINEERED_SOURCES`. Returns an unsubscribe function.

#### Parameters

##### listener

[`ContextInjectedListener`](/agentfootprint/api/generated/type-aliases/ContextInjectedListener.md)

#### Returns

[`ContextEngineeringUnsubscribe`](/agentfootprint/api/generated/type-aliases/ContextEngineeringUnsubscribe.md)
