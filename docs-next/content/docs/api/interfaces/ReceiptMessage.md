---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/lib/time-travel/receipt.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L194)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L196)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/lib/time-travel/receipt.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L199)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:195](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L195)
