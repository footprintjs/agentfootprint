---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/lib/time-travel/receipt.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L181)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L183)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/lib/time-travel/receipt.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L186)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L182)
