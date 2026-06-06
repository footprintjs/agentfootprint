[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EvalScorePayload

# Interface: EvalScorePayload

Defined in: [src/events/payloads.ts:492](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L492)

## Properties

### evaluator?

> `readonly` `optional` **evaluator?**: `"llm"` \| `"fn"` \| `"heuristic"`

Defined in: [src/events/payloads.ts:498](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L498)

***

### evidence?

> `readonly` `optional` **evidence?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/events/payloads.ts:499](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L499)

***

### metricId

> `readonly` **metricId**: `string`

Defined in: [src/events/payloads.ts:493](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L493)

***

### target

> `readonly` **target**: `"iteration"` \| `"turn"` \| `"run"` \| `"toolCall"`

Defined in: [src/events/payloads.ts:496](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L496)

***

### targetRef

> `readonly` **targetRef**: `string`

Defined in: [src/events/payloads.ts:497](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L497)

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/events/payloads.ts:495](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L495)

***

### value

> `readonly` **value**: `number`

Defined in: [src/events/payloads.ts:494](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L494)
