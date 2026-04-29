[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MemoryStrategyAppliedPayload

# Interface: MemoryStrategyAppliedPayload

Defined in: [agentfootprint/src/events/payloads.ts:235](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L235)

## Properties

### addedIds

> `readonly` **addedIds**: readonly `string`[]

Defined in: [agentfootprint/src/events/payloads.ts:248](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L248)

***

### droppedIds

> `readonly` **droppedIds**: readonly `string`[]

Defined in: [agentfootprint/src/events/payloads.ts:247](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L247)

***

### inputMemoryCount

> `readonly` **inputMemoryCount**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:245](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L245)

***

### outputMemoryCount

> `readonly` **outputMemoryCount**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:246](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L246)

***

### reason

> `readonly` **reason**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:243](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L243)

***

### scoreEvidence?

> `readonly` `optional` **scoreEvidence?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [agentfootprint/src/events/payloads.ts:244](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L244)

***

### strategyId

> `readonly` **strategyId**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:236](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L236)

***

### strategyKind

> `readonly` **strategyKind**: `"sliding-window"` \| `"summarizing"` \| `"semantic"` \| `"fact-extraction"` \| `"hybrid"`

Defined in: [agentfootprint/src/events/payloads.ts:237](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L237)
