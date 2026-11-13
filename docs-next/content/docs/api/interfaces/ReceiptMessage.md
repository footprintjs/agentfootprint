---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/core/agent/receipt/receipt.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L227)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L229)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L232)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/core/agent/receipt/receipt.ts:228](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L228)
