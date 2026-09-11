---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/lib/time-travel/receipt.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L206)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L208)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/lib/time-travel/receipt.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L211)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L207)
