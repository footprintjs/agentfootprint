---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/lib/time-travel/receipt.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L182)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L184)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/lib/time-travel/receipt.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L187)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L183)
