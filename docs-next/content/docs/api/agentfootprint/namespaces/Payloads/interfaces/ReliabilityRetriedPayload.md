---
title: ReliabilityRetriedPayload
---

# Interface: ReliabilityRetriedPayload

Defined in: [src/events/payloads.ts:725](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L725)

Fired each time the rules loop decides to RETRY after a failed attempt
— `action` distinguishes a same-provider retry from a provider failover.

## Properties

### action

> `readonly` **action**: `"retry"` \| `"retry-other"`

Defined in: [src/events/payloads.ts:729](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L729)

`retry` = same provider again; `retry-other` = switch provider.

***

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:727](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L727)

1-indexed counter of the attempt that just FAILED and is being retried.

***

### errorKind

> `readonly` **errorKind**: `string`

Defined in: [src/events/payloads.ts:731](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L731)

Classification of the failure being retried.

***

### errorMessage?

> `readonly` `optional` **errorMessage?**: `string`

Defined in: [src/events/payloads.ts:733](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L733)

Originating error message, when present.

***

### fromProvider

> `readonly` **fromProvider**: `string`

Defined in: [src/events/payloads.ts:735](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L735)

Provider that just failed.

***

### toProvider

> `readonly` **toProvider**: `string`

Defined in: [src/events/payloads.ts:737](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L737)

Provider the NEXT attempt will use (equals `fromProvider` for `retry`).
