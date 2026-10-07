---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/lib/time-travel/receipt.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L212)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L214)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/lib/time-travel/receipt.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L217)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L213)
