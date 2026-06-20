---
title: ReliabilityRecoveredPayload
---

# Interface: ReliabilityRecoveredPayload

Defined in: [src/events/payloads.ts:745](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L745)

Fired when the rules loop produces a successful response AFTER one or
more failed attempts (self-healed). `recoveredVia` names the mechanism
of the final successful step.

## Properties

### attempt

> `readonly` **attempt**: `number`

Defined in: [src/events/payloads.ts:747](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L747)

1-indexed attempt number that finally succeeded.

***

### errorKind

> `readonly` **errorKind**: `string`

Defined in: [src/events/payloads.ts:753](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L753)

Classification of the LAST failure before recovery.

***

### priorFailures

> `readonly` **priorFailures**: `number`

Defined in: [src/events/payloads.ts:751](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L751)

How many attempts failed before this success.

***

### recoveredVia

> `readonly` **recoveredVia**: `"retry"` \| `"retry-other"` \| `"fallback"`

Defined in: [src/events/payloads.ts:749](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L749)

How recovery happened.
