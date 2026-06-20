---
title: CostLimitHitPayload
---

# Interface: CostLimitHitPayload

Defined in: [src/events/payloads.ts:589](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L589)

## Properties

### action

> `readonly` **action**: `"warn"` \| `"abort"` \| `"degrade"`

Defined in: [src/events/payloads.ts:593](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L593)

***

### actual

> `readonly` **actual**: `number`

Defined in: [src/events/payloads.ts:592](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L592)

***

### kind

> `readonly` **kind**: `"max_tokens"` \| `"max_cost"` \| `"max_iterations"` \| `"max_wallclock"`

Defined in: [src/events/payloads.ts:590](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L590)

***

### limit

> `readonly` **limit**: `number`

Defined in: [src/events/payloads.ts:591](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L591)
