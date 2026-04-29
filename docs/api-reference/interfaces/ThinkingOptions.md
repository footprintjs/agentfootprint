[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ThinkingOptions

# Interface: ThinkingOptions

Defined in: [agentfootprint/src/recorders/observability/ThinkingRecorder.ts:20](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/ThinkingRecorder.ts#L20)

## Properties

### format?

> `readonly` `optional` **format?**: (`event`) => `string` \| `null`

Defined in: [agentfootprint/src/recorders/observability/ThinkingRecorder.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/ThinkingRecorder.ts#L30)

Custom formatter. Return `null` to skip an event; return a string
to emit that status. Omit for the built-in renderer.

#### Parameters

##### event

[`ThinkingEvent`](/agentfootprint/api/generated/type-aliases/ThinkingEvent.md)

#### Returns

`string` \| `null`

***

### onStatus

> `readonly` **onStatus**: (`status`) => `void`

Defined in: [agentfootprint/src/recorders/observability/ThinkingRecorder.ts:25](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/ThinkingRecorder.ts#L25)

Called with a human-readable status string at each meaningful moment
(iteration start, tool start/end, route decision, turn end).

#### Parameters

##### status

`string`

#### Returns

`void`
