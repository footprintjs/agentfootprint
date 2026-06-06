[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MemoryStrategyAppliedPayload

# Interface: MemoryStrategyAppliedPayload

Defined in: [src/events/payloads.ts:292](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L292)

## Properties

### addedIds

> `readonly` **addedIds**: readonly `string`[]

Defined in: [src/events/payloads.ts:305](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L305)

***

### droppedIds

> `readonly` **droppedIds**: readonly `string`[]

Defined in: [src/events/payloads.ts:304](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L304)

***

### inputMemoryCount

> `readonly` **inputMemoryCount**: `number`

Defined in: [src/events/payloads.ts:302](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L302)

***

### outputMemoryCount

> `readonly` **outputMemoryCount**: `number`

Defined in: [src/events/payloads.ts:303](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L303)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/events/payloads.ts:300](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L300)

***

### scoreEvidence?

> `readonly` `optional` **scoreEvidence?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/events/payloads.ts:301](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L301)

***

### strategyId

> `readonly` **strategyId**: `string`

Defined in: [src/events/payloads.ts:293](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L293)

***

### strategyKind

> `readonly` **strategyKind**: `"sliding-window"` \| `"summarizing"` \| `"semantic"` \| `"fact-extraction"` \| `"hybrid"`

Defined in: [src/events/payloads.ts:294](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L294)
