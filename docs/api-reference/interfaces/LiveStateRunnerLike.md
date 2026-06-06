[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LiveStateRunnerLike

# Interface: LiveStateRunnerLike

Defined in: [src/recorders/observability/LiveStateRecorder.ts:73](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L73)

Minimal Runner shape this recorder needs — only the public `on(...)`
 subscription method, so the same trackers can attach to a real Runner
 (Agent, etc.) OR to a test mock without exposing the protected
 internal dispatcher.

## Methods

### on()

> **on**\<`K`\>(`type`, `listener`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/recorders/observability/LiveStateRecorder.ts:74](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LiveStateRecorder.ts#L74)

#### Type Parameters

##### K

`K` *extends* keyof [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)

#### Parameters

##### type

`K`

##### listener

(`event`) => `void`

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
