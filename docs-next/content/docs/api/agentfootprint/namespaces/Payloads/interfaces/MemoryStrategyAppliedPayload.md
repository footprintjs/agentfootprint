---
title: MemoryStrategyAppliedPayload
---

# Interface: MemoryStrategyAppliedPayload

Defined in: [src/events/payloads.ts:334](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L334)

## Properties

### addedIds

> `readonly` **addedIds**: readonly `string`[]

Defined in: [src/events/payloads.ts:347](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L347)

***

### droppedIds

> `readonly` **droppedIds**: readonly `string`[]

Defined in: [src/events/payloads.ts:346](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L346)

***

### inputMemoryCount

> `readonly` **inputMemoryCount**: `number`

Defined in: [src/events/payloads.ts:344](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L344)

***

### outputMemoryCount

> `readonly` **outputMemoryCount**: `number`

Defined in: [src/events/payloads.ts:345](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L345)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/events/payloads.ts:342](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L342)

***

### scoreEvidence?

> `readonly` `optional` **scoreEvidence?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/events/payloads.ts:343](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L343)

***

### strategyId

> `readonly` **strategyId**: `string`

Defined in: [src/events/payloads.ts:335](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L335)

***

### strategyKind

> `readonly` **strategyKind**: `"sliding-window"` \| `"summarizing"` \| `"semantic"` \| `"fact-extraction"` \| `"hybrid"`

Defined in: [src/events/payloads.ts:336](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L336)
