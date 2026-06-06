[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StatusOptions

# Interface: StatusOptions

Defined in: [src/recorders/observability/StatusRecorder.ts:22](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/StatusRecorder.ts#L22)

## Properties

### format?

> `readonly` `optional` **format?**: (`event`) => `string` \| `null`

Defined in: [src/recorders/observability/StatusRecorder.ts:32](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/StatusRecorder.ts#L32)

Custom formatter. Return `null` to skip an event; return a string
to emit that status. Omit for the built-in renderer.

#### Parameters

##### event

[`StatusEvent`](/agentfootprint/api/generated/type-aliases/StatusEvent.md)

#### Returns

`string` \| `null`

***

### onStatus

> `readonly` **onStatus**: (`status`) => `void`

Defined in: [src/recorders/observability/StatusRecorder.ts:27](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/StatusRecorder.ts#L27)

Called with a human-readable status string at each meaningful moment
(iteration start, tool start/end, route decision, turn end).

#### Parameters

##### status

`string`

#### Returns

`void`
