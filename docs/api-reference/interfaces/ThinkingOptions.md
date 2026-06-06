[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ThinkingOptions

# Interface: ThinkingOptions

Defined in: [src/recorders/observability/ThinkingRecorder.ts:22](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/ThinkingRecorder.ts#L22)

## Properties

### format?

> `readonly` `optional` **format?**: (`event`) => `string` \| `null`

Defined in: [src/recorders/observability/ThinkingRecorder.ts:32](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/ThinkingRecorder.ts#L32)

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

Defined in: [src/recorders/observability/ThinkingRecorder.ts:27](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/ThinkingRecorder.ts#L27)

Called with a human-readable status string at each meaningful moment
(iteration start, tool start/end, route decision, turn end).

#### Parameters

##### status

`string`

#### Returns

`void`
