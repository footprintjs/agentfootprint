---
title: ReceiptMessage
---

# Interface: ReceiptMessage

Defined in: [src/core/agent/receipt/receipt.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L217)

One message as it went out.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L219)

***

### key?

> `readonly` `optional` **key?**: `string`

Defined in: [src/core/agent/receipt/receipt.ts:222](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L222)

The message's own join key when it has one — a tool result's
 `toolCallId`. Absent for every other message.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/core/agent/receipt/receipt.ts:218](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/receipt/receipt.ts#L218)
