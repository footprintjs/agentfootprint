---
title: ReceiptRequestOnlyMessage
---

# Interface: ReceiptRequestOnlyMessage

Defined in: [src/lib/time-travel/receipt.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L203)

A line that existed on the request only and was never written to history.

## Properties

### hash

> `readonly` **hash**: `string`

Defined in: [src/lib/time-travel/receipt.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L205)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/lib/time-travel/receipt.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L207)

Which library mechanism composed it. `'staged-refs-nudge'` today.

***

### role

> `readonly` **role**: `ContextRole`

Defined in: [src/lib/time-travel/receipt.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L204)
