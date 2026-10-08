---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/lib/time-travel/receipt.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L216)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L218)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/lib/time-travel/receipt.ts:221](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L221)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L217)
