---
title: ContextEngineeringHandle
---

# Interface: ContextEngineeringHandle

Defined in: [src/recorders/core/contextEngineering.ts:137](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/contextEngineering.ts#L137)

Handle returned by `contextEngineering(agent)`. Lets consumers
subscribe to engineered / baseline streams and detach cleanly.

## Methods

### detach()

> **detach**(): `void`

Defined in: [src/recorders/core/contextEngineering.ts:153](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/contextEngineering.ts#L153)

Detach all subscriptions registered through this handle. After
calling, no further callbacks will fire. Idempotent (safe to
call multiple times).

#### Returns

`void`

***

### onBaseline()

> **onBaseline**(`listener`): [`ContextEngineeringUnsubscribe`](/docs/api/type-aliases/ContextEngineeringUnsubscribe)

Defined in: [src/recorders/core/contextEngineering.ts:147](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/contextEngineering.ts#L147)

Fires for `context.injected` events whose source is in
`BASELINE_SOURCES`. Returns an unsubscribe function.

#### Parameters

##### listener

[`ContextInjectedListener`](/docs/api/type-aliases/ContextInjectedListener)

#### Returns

[`ContextEngineeringUnsubscribe`](/docs/api/type-aliases/ContextEngineeringUnsubscribe)

***

### onEngineered()

> **onEngineered**(`listener`): [`ContextEngineeringUnsubscribe`](/docs/api/type-aliases/ContextEngineeringUnsubscribe)

Defined in: [src/recorders/core/contextEngineering.ts:142](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/recorders/core/contextEngineering.ts#L142)

Fires for `context.injected` events whose source is in
`ENGINEERED_SOURCES`. Returns an unsubscribe function.

#### Parameters

##### listener

[`ContextInjectedListener`](/docs/api/type-aliases/ContextInjectedListener)

#### Returns

[`ContextEngineeringUnsubscribe`](/docs/api/type-aliases/ContextEngineeringUnsubscribe)
