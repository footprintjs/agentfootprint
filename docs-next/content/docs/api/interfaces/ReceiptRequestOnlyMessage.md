---
title: ReceiptRequestOnlyMessage
---

# Interface: ReceiptRequestOnlyMessage

Defined in: [src/lib/time-travel/receipt.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L190)

A line that existed on the request only and was never written to history.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L192)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/lib/time-travel/receipt.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L194)

Which library mechanism composed it. `'staged-refs-nudge'` today.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L191)
