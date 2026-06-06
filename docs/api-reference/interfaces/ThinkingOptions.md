[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ThinkingOptions

# Interface: ThinkingOptions

Defined in: [src/recorders/observability/ThinkingRecorder.ts:20](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/ThinkingRecorder.ts#L20)

## Properties

### format?

> `readonly` `optional` **format?**: (`event`) => `string` \| `null`

Defined in: [src/recorders/observability/ThinkingRecorder.ts:30](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/ThinkingRecorder.ts#L30)

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

Defined in: [src/recorders/observability/ThinkingRecorder.ts:25](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/ThinkingRecorder.ts#L25)

Called with a human-readable status string at each meaningful moment
(iteration start, tool start/end, route decision, turn end).

#### Parameters

##### status

`string`

#### Returns

`void`
